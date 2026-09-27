// M27 versioned wire contract under construction (server integration pending).
// Unlike the legacy kg-only board payloads, every
// ranked value here is discriminated by metric and unit. Keys stay snake_case.
import type { LoadInputMode } from '../exercise-core/index.ts';
import type { GroupMetric, GroupMetricValue } from './metric-contract.ts';

export type GroupMetricRulesWire = {
  bodyweight_coefficient: number;
  movement_standard: string | null;
  loading_method: string | null;
  load_input_mode: LoadInputMode;
  default_metric: GroupMetric;
  rules_revision: number;
};
export type GroupMetricExerciseWire = GroupMetricRulesWire & {
  group_exercise_id: string;
  name: string;
  source_exercise_id: string | null;
  archived_at_ms: number | null;
  published_revision: number | null;
  rebuilding: boolean;
};

/** Only the saved shared-session tuple is exposed; never the reading timeline. */
export type GroupPerformanceSnapshotWire = {
  session_id: string;
  session_exercise_id: string;
  exercise_definition_id: string;
  set_id: string;
  weight_value: string;
  weight_unit: 'kg' | 'lb';
  external_load_mode: 'added' | 'assistance' | 'unquantified_assistance' | null;
  reps_value: string;
  reps: number;
  performance_status: string | null;
  source_load_input_mode: LoadInputMode;
  movement_standard: string | null;
  loading_method: string | null;
  body_weight_status: 'known' | 'missing' | 'invalid';
  /** Invalid stored tuples are labelled, never rendered as usable readings. */
  body_weight_kg: number | null;
  body_weight_source: 'reading' | 'manual' | 'historical_estimate' | null;
  body_weight_measurement_id: string | null;
  body_weight_measured_at_ms: number | null;
  achieved_at_ms: number;
  exercise_order_index: number;
  set_order_index: number;
};

export type GroupMetricScoreWire = GroupMetricValue & { rules_revision: number };
export type GroupMetricHolderWire = GroupMetricScoreWire & {
  member: { user_id: string; username: string | null };
  former: boolean;
  achieved_at_ms: number;
  set_id: string;
};
export type GroupMetricBoardRowWire = GroupMetricHolderWire & {
  rank: number;
  performance: GroupPerformanceSnapshotWire;
  effective_resistance_kg: number | null;
  external_adjustment_kg: number | null;
  added_percent_bodyweight: number | null;
  certified: boolean;
  certification_id: string | null;
};
export type GroupMetricBoardWire = {
  contract_version: 2;
  exercise: GroupMetricExerciseWire;
  metric: GroupMetric;
  certified: boolean;
  /** All rows have this revision. A rebuilding current view returns no rows. */
  rules_revision: number;
  state: 'ready' | 'rebuilding' | 'archived';
  entries: GroupMetricBoardRowWire[];
  entry_count: number;
  me: GroupMetricBoardRowWire | null;
  /** Opaque cursor binds group exercise, metric, scope and rules revision. */
  next_cursor: string | null;
};
export type GroupMetricPodiumWire = {
  contract_version: 2;
  exercises: {
    exercise: GroupMetricExerciseWire;
    metric: GroupMetric;
    certified: boolean;
    rules_revision: number;
    state: GroupMetricBoardWire['state'];
    podium: GroupMetricBoardRowWire[];
    me: GroupMetricBoardRowWire | null;
    entry_count: number;
    all_entry_count: number;
  }[];
};

/** The rule revision explains the score; the pin attests raw dependencies. */
export type GroupMetricCertificationWire = {
  certification_id: string;
  metric: GroupMetric;
  rules_revision: number;
  certified_by: { user_id: string; username: string | null };
  certified_at_ms: number;
  performance: GroupPerformanceSnapshotWire;
  /** Bodyweight/provenance is a strength dependency; reps-only excludes it. */
  includes_body_weight: boolean;
  ended_at_ms: number | null;
  end_reason: 'withdrawn' | 'cancelled' | 'voided' | null;
};

/** Prior revisions retain their original labels, units and frozen entries. */
export type GroupMetricRevisionWire = {
  rules: GroupMetricRulesWire;
  published_at_ms: number | null;
  retired_at_ms: number | null;
  reason: 'initial' | 'activation' | 'rules_change';
  legacy: boolean;
};

export type GroupMetricRecordBoardWire = GroupMetricValue & {
  previous_value: number | null;
  group_record: boolean;
  /** Each metric pins its own dependencies, including B only when needed. */
  fingerprint: string;
};

type GroupMetricEventBase = {
  event_id: string;
  sequence: number;
  group_exercise_id: string;
  rules_revision: number;
  sort_at_ms: number;
  member: { user_id: string; username: string | null } | null;
};
/** Rule history and performed records remain distinguishable on every reader. */
export type GroupMetricEventWire = GroupMetricEventBase & (
  | { kind: 'record'; session_id: string; set_id: string; provisional: boolean;
      performance: GroupPerformanceSnapshotWire; boards: GroupMetricRecordBoardWire[] }
  | { kind: 'record_voided'; related_event_id: string; reason: 'deleted' | 'edited';
      performance: GroupPerformanceSnapshotWire;
      leaders: { metric: GroupMetric; leader: GroupMetricHolderWire | null }[] }
  | { kind: 'lead_change'; metric: GroupMetric; certified: boolean;
      reason: 'record' | 'void' | 'link' | 'certification';
      related_event_id: string | null; certification_id: string | null;
      leader: GroupMetricHolderWire | null; previous: GroupMetricHolderWire | null }
  | { kind: 'link' | 'unlink'; exercise_definition_ids: string[];
      effects: { metric: GroupMetric; before: (GroupMetricScoreWire & { rank: number }) | null;
        after: (GroupMetricScoreWire & { rank: number }) | null }[] }
  | { kind: 'rules_change'; previous_revision: number; rules: GroupMetricRulesWire }
);

export type GroupMetricHistoryWire = {
  contract_version: 2;
  exercise: GroupMetricExerciseWire;
  revision: GroupMetricRevisionWire;
  metric: GroupMetric;
  certified: boolean;
  events: GroupMetricEventWire[];
  /** History pagination also binds revision, metric and scope. */
  next_cursor: string | null;
};
