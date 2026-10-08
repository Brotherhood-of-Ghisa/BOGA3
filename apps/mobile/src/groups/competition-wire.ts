import type { LoadInputMode } from '../exercise-core/index.ts';
import type { CompetitionMetric, CompetitionValue } from './competition-contract.ts';
import type { GroupMemberRef } from './types.ts';

export type CompetitionRulesWire = {
  bodyweight_calculations_enabled: boolean;
  bodyweight_contribution: number;
  load_input_mode: LoadInputMode;
  default_metric: CompetitionMetric;
  rules_revision: number;
};
/** Explicitly scoped to one authorized group; this shape has no private audit. */
export type CompetitionPerformanceWire = {
  session_id: string;
  session_exercise_id: string;
  exercise_definition_id: string;
  set_id: string;
  reps: number;
  performance_status: null;
  source_load_input_mode: LoadInputMode;
  achieved_at_ms: number;
  exercise_order_index: number;
  set_order_index: number;
} & ({ visibility: 'normalized' } | { visibility: 'ordinary'; weight_value: string });

/** Current projection state; original observed values remain server-only audit. */
export type CompetitionCertificationWire = {
  certification_id: string;
  metric: CompetitionMetric;
  certified_by: GroupMemberRef | null;
  certified_at_ms: number;
  observed_rules_revision: number;
  ended_at_ms: number | null;
  end_reason: 'withdrawn' | 'cancelled' | 'voided' | null;
};
export type CompetitionBoardRowWire = CompetitionValue & {
  rank: number;
  member: GroupMemberRef;
  former: boolean;
  performance: CompetitionPerformanceWire;
  /** Random server-issued write capability; NEVER a private dependency digest. */
  write_token: string;
  certification: CompetitionCertificationWire | null;
};
export type CompetitionBoardWire = {
  contract_version: 4;
  group_exercise_id: string;
  rules: CompetitionRulesWire;
  metric: CompetitionMetric;
  certified: boolean;
  state: 'ready' | 'rebuilding' | 'archived';
  entries: CompetitionBoardRowWire[];
  entry_count: number;
  me: CompetitionBoardRowWire | null;
  next_cursor: string | null;
};

export type CompetitionExerciseWire = {
  group_exercise_id: string; name: string; source_exercise_id: string | null;
  archived_at_ms: number | null; rules: CompetitionRulesWire;
  published_revision: number | null; rebuilding: boolean;
};
export type CompetitionExerciseListWire = { contract_version: 4; exercises: CompetitionExerciseWire[] };
export type CompetitionExerciseWriteWire = { contract_version: 4; exercise: CompetitionExerciseWire };
export type CompetitionCertificationResultWire = {
  contract_version: 4; certification: CompetitionCertificationWire;
};
export type CompetitionCertifyResultWire = CompetitionCertificationResultWire & { created: boolean };
export type CompetitionPodiumsWire = {
  contract_version: 4; certified: boolean;
  podiums: { exercise: CompetitionExerciseWire; board: CompetitionBoardWire }[];
};
/** Historical metric labels never migrate into the current metric domain. */
export type CompetitionHistoricalMetric = 'weight' | 'volume' | 'e1rm' | 'bodyweight_reps' | 'relative_strength' | 'absolute_strength';
export type CompetitionRevisionWire = {
  rules_revision: number; representation_version: 3 | 4;
  rules: Omit<CompetitionRulesWire, 'rules_revision' | 'default_metric'> & { default_metric: CompetitionHistoricalMetric };
  reason: 'initial' | 'activation' | 'rules_change'; legacy: boolean;
  published_at_ms: number | null; retired_at_ms: number | null;
};
export type CompetitionHistoryValueWire = {
  role: 'record' | 'leader' | 'previous' | 'before' | 'after';
  metric: CompetitionHistoricalMetric; unit: string;
  value: number | null; unavailable: boolean; member: GroupMemberRef | null;
};
export type CompetitionRecordContextWire = {
  exercise: CompetitionExerciseWire; former: boolean;
  metrics: { metric: CompetitionMetric; write_token: string; eligible: boolean; certification: CompetitionCertificationWire | null }[];
};
export type CompetitionEventWire = {
  event_id: string; sequence: number;
  kind: 'record' | 'record_voided' | 'lead_change' | 'link' | 'unlink' | 'rules_change';
  group: { group_id: string; name: string }; group_exercise: { group_exercise_id: string; name: string };
  rules_revision: number; representation_version: 1 | 3 | 4; visibility: 'normalized' | 'ordinary'; sort_at_ms: number;
  member: GroupMemberRef | null; metric: CompetitionHistoricalMetric | null;
  certified: boolean | null; reason: string | null; related_event_id: string | null;
  session_id: string | null; set_id: string | null; reps: number | null;
  provisional: boolean; voided: boolean; values: CompetitionHistoryValueWire[];
  record_context: CompetitionRecordContextWire | null;
};
export type CompetitionHistoryWire = {
  contract_version: 4; exercise: CompetitionExerciseWire; revision: CompetitionRevisionWire;
  metric: CompetitionHistoricalMetric; certified: boolean; events: CompetitionEventWire[]; next_cursor: string | null;
};
export type CompetitionRevisionsWire = { contract_version: 4; exercise: CompetitionExerciseWire; revisions: CompetitionRevisionWire[] };
export type CompetitionSessionSetWire = {
  set_id: string; order_index: number; reps_value: string; set_type: string | null;
  performance_status: string | null;
};
export type CompetitionSessionExerciseWire = {
  session_exercise_id: string; exercise_definition_id: string | null; load_input_mode: LoadInputMode | null;
  name: string; machine_name: string | null; order_index: number;
} & ({ visibility: 'normalized'; sets: CompetitionSessionSetWire[] }
  | { visibility: 'ordinary'; sets: (CompetitionSessionSetWire & { weight_value: string })[] });
export type CompetitionSessionWire = {
  member: GroupMemberRef; session_id: string; gym_name: string | null; status: 'draft' | 'active' | 'completed';
  started_at_ms: number; completed_at_ms: number | null; duration_sec: number | null;
  exercises: CompetitionSessionExerciseWire[];
};
export type CompetitionSessionDetailWire = { contract_version: 4; group_id: string; session: CompetitionSessionWire };
/** One #1 board a session's record took, and that All board's current leader (null when the record's revision or metric has no current board). */
export type CompetitionSessionRecordBoardWire = { metric: CompetitionHistoricalMetric; leader: GroupMemberRef | null; leads: boolean };
/** A record event whose `record` values are the #1 boards only, one `boards` entry each. */
export type CompetitionSessionRecordWire = { event: CompetitionEventWire; boards: CompetitionSessionRecordBoardWire[] };
export type CompetitionSessionRecordsWire = {
  contract_version: 4; group_id: string; member_user_id: string; session_id: string; records: CompetitionSessionRecordWire[];
};
export type CompetitionStreamItemWire =
  | { kind: 'competition'; key: string; sort_at_ms: number; event: CompetitionEventWire }
  | { kind: 'session'; key: string; sort_at_ms: number; groups: { group_id: string; name: string }[]; session: CompetitionSessionWire }
  | { kind: 'membership'; key: string; sort_at_ms: number; event: 'joined' | 'left' | 'removed';
      group: { group_id: string; name: string }; member: GroupMemberRef };
export type CompetitionStreamWire = { contract_version: 4; items: CompetitionStreamItemWire[]; next_cursor: string | null; has_more: boolean };
export type CompetitionWeekSummaryWire = {
  contract_version: 4; group_id: string;
  members: { rank: number; member: GroupMemberRef; working_sets: number; group_records: number }[];
  training_now: { member: GroupMemberRef; session_id: string; started_at_ms: number; gym_name: string | null;
    working_sets: number; exercise_count: number }[];
  latest_completed: null | { member: GroupMemberRef; session_id: string; started_at_ms: number; completed_at_ms: number | null;
    duration_sec: number | null; gym_name: string | null; working_sets: number; exercise_count: number; group_records: CompetitionEventWire[] };
};
