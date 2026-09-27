// M27 versioned metric boundary. Legacy payloads remain explicitly tagged.
// Unlike the legacy kg-only board payloads, every
// ranked value here is discriminated by metric and unit. Keys stay snake_case.
import type { LoadInputMode } from '../exercise-core/index.ts';
import type { GroupMetric, GroupMetricValue } from './metric-contract.ts';
import type { GroupBoardPodiumExercise, GroupMemberRef, GroupRef, StreamCursor, StreamMembershipItem, StreamSessionItem } from './types.ts';

export type GroupMetricRulesWire = {
  bodyweight_coefficient: number;
  movement_standard: string | null;
  loading_method: string | null;
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
  fingerprint: string;
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
export type GroupMetricPodiumCardWire = {
  legacy: false;
  exercise: GroupMetricExerciseWire;
  metric: GroupMetric;
  certified: boolean;
  rules_revision: number;
  state: GroupMetricBoardWire['state'];
  podium: GroupMetricBoardRowWire[];
  me: GroupMetricBoardRowWire | null;
  entry_count: number;
  all_entry_count: number;
} | { legacy: true; exercise: GroupMetricExerciseWire; board: GroupBoardPodiumExercise };
export type GroupMetricPodiumWire = { contract_version: 2; exercises: GroupMetricPodiumCardWire[] };

/** The rule revision explains the score; the pin attests raw dependencies. */
export type GroupMetricCertificationWire = {
  certification_id: string;
  metric: GroupMetric;
  rules_revision: number;
  certified_by: GroupMemberRef | null;
  value: number;
  unit: GroupMetricValue['unit'];
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
  legacy_entries?: GroupLegacyRevisionEntryWire[] | null;
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
  | { kind: 'record'; session_id: string; set_id: string; provisional: boolean; voided: boolean;
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
  events: (GroupMetricEventWire | GroupLegacyMetricHistoryWire)[];
  /** History pagination also binds revision, metric and scope. */
  next_cursor: string | null;
};


/** Original kg-only retirement rows; no bodyweight context is inferred. */
export type GroupLegacyRevisionEntryWire = {
  member_user_id: string;
  member: GroupMemberRef;
  metric: 'weight' | 'e1rm';
  unit: 'kg';
  rules_revision: number;
  certified: boolean;
  value_kg: number;
  weight_kg: number;
  reps: number;
  e1rm_kg: number | null;
  achieved_at_ms: number;
  session_id: string;
  set_id: string;
};
export type GroupLegacyMetricHistoryWire = {
  legacy: true;
  event_id: string;
  sequence: number;
  sort_at_ms: number;
  metric: 'weight' | 'e1rm';
  unit: 'kg';
  reason: string;
  payload: Record<string, unknown>;
};
export type GroupMetricRevisionsWire = {
  contract_version: 2; exercise: GroupMetricExerciseWire; revisions: GroupMetricRevisionWire[];
};
export type GroupMetricExerciseListWire = { contract_version: 2; exercises: GroupMetricExerciseWire[] };
export type GroupMetricExerciseWriteWire = { contract_version: 2; exercise: GroupMetricExerciseWire };
export type GroupMetricCertificationResultWire = {
  contract_version: 2; certification: GroupMetricCertificationWire; created?: boolean;
};

export type GroupMetricRecordContextWire = {
  exercise: GroupMetricExerciseWire;
  former: boolean;
  metrics: {
    metric: GroupMetric; fingerprint: string; eligible: boolean;
    effective_resistance_kg: number | null; external_adjustment_kg: number | null;
    added_percent_bodyweight: number | null;
    certification: GroupMetricCertificationWire | null;
  }[];
};

type MetricLinkEvent = Extract<GroupMetricEventWire, { kind: 'link' | 'unlink' }>;
export type GroupMetricStreamItemWire = (
  Exclude<GroupMetricEventWire, MetricLinkEvent> |
  (Omit<MetricLinkEvent, 'kind'> & { kind: 'link'; event: 'link' | 'unlink' })
) & {
  metric_event: true;
  /** Missing in older cached v2 pages: details remain read-only until refreshed. */
  record_context?: GroupMetricRecordContextWire;
  key: string;
  group: GroupRef;
  group_exercise: GroupMetricRulesWire & { group_exercise_id: string; name: string };
};
export type GroupMetricStreamCursor = Omit<StreamCursor, 'kind'> & { kind: StreamCursor['kind'] | 'rules_change' };
export type GroupMetricStreamWire = {
  contract_version: 2;
  items: (StreamSessionItem | StreamMembershipItem | GroupMetricStreamItemWire |
    (import('./types.ts').StreamRecordItem & { legacy: true; rules_revision: number }) |
    (import('./types.ts').StreamRecordVoidedItem & { legacy: true; rules_revision: number }) |
    (import('./types.ts').StreamLinkItem & { legacy: true; rules_revision: number }))[];
  next_cursor: GroupMetricStreamCursor | null;
  has_more: boolean;
};

/** Presentation accepts retained legacy items and metric-aware events in one feed. */
export type CurrentGroupStreamItem = import('./types.ts').StreamItem | GroupMetricStreamItemWire;
export type CurrentGroupStreamPage = {
  items: CurrentGroupStreamItem[]; next_cursor: GroupMetricStreamCursor | null; has_more: boolean;
};
export function isMetricStreamEvent(item: CurrentGroupStreamItem): item is GroupMetricStreamItemWire {
  return 'metric_event' in item && item.metric_event === true;
}
