import type { LoadInputMode } from '../exercise-core/index.ts';
import type { CompetitionMetric, CompetitionValue } from './competition-contract.ts';
import type { GroupMemberRef } from './types.ts';

export type CompetitionContractWire = {
  contract_version: 4;
  activation_state: 'pending' | 'active';
  cache_version: 5;
  metrics: ['volume', 'e1rm'];
  ordinary_units: { volume: 'kg_reps'; e1rm: 'kg' };
  normalized_units: { volume: 'percent_bw_reps'; e1rm: 'percent_bw' };
  default_metric: 'e1rm';
};
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
