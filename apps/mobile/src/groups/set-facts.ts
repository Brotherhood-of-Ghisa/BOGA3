// The one implementation of the group set rules, shared by the viewing device
// (`session-metrics.ts`, groups contract §5) and the `group-eval` Edge Function
// (§2.9), which loads this file from Deno by relative path. So: no `@/` alias,
// and every import names its `.ts` file (tsconfig `allowImportingTsExtensions`).
// The imported modules import nothing themselves.

import { estimateOneRepMax, parseCalculationSet } from '../exercise-calculations/index.ts';
import {
  canonicalizeWeightForReps,
  isConfirmedPerformedSet,
  normalizeSessionSetPerformanceStatus,
} from '../session-recorder/set-semantics.ts';

/** Bump when a rule below changes: every older fact is re-normalized, silently. */
export const GROUP_EVAL_RULES_VERSION = 1;

export type GroupRawSetValues = {
  weight_value: string;
  reps_value: string;
  performance_status: string | null;
};

export type GroupParsedSet = { weightKg: number; reps: number };

/**
 * The parsed kg and reps of a confirmed performed set, else null. A blank
 * weight with valid reps is 0 kg (the recorder's canonicalization); a value the
 * recorder's input cannot produce (for example `1e3`) is not performed.
 */
export const parseGroupPerformedSet = (set: GroupRawSetValues): GroupParsedSet | null => {
  const performanceStatus = normalizeSessionSetPerformanceStatus(set.performance_status);
  if (!isConfirmedPerformedSet({ weight: set.weight_value, reps: set.reps_value, performanceStatus })) {
    return null;
  }
  const parsed = parseCalculationSet({
    weightValue: canonicalizeWeightForReps(set.weight_value, set.reps_value),
    repsValue: set.reps_value,
  });
  return parsed === null ? null : { weightKg: parsed.weight, reps: parsed.reps };
};

/** One raw set row as `group_eval_session_rows` returns it. */
export type GroupEvalSetRow = GroupRawSetValues & {
  set_id: string;
  session_exercise_id: string;
  exercise_definition_id: string | null;
  exercise_order_index: number;
  set_order_index: number;
  live: boolean;
  fingerprint: string;
};

export type GroupEvalSessionRows = {
  session_id: string;
  started_at_ms: number | null;
  sets: GroupEvalSetRow[];
};

/** One `group_set_facts` row as `group_eval_complete` accepts it. */
export type GroupSetFact = {
  set_id: string;
  session_exercise_id: string;
  exercise_definition_id: string | null;
  exercise_order_index: number;
  set_order_index: number;
  performed: boolean;
  live: boolean;
  weight_kg: number | null;
  reps: number | null;
  e1rm_kg: number | null;
  achieved_at_ms: number;
  fingerprint: string;
  rules_version: number;
};

/**
 * Facts for every set of a session, in the member's entered load mode (the
 * group exercise's mode is applied later, in SQL). A session that no longer
 * exists yields none, so its facts are cleared.
 */
export const normalizeGroupSetFacts = (rows: GroupEvalSessionRows): GroupSetFact[] => {
  const startedAtMs = rows.started_at_ms;
  if (startedAtMs === null) {
    return [];
  }
  return rows.sets.map((set) => {
    const parsed = parseGroupPerformedSet(set);
    return {
      set_id: set.set_id,
      session_exercise_id: set.session_exercise_id,
      exercise_definition_id: set.exercise_definition_id,
      exercise_order_index: set.exercise_order_index,
      set_order_index: set.set_order_index,
      performed: parsed !== null,
      live: set.live,
      weight_kg: parsed?.weightKg ?? null,
      reps: parsed?.reps ?? null,
      e1rm_kg: parsed === null ? null : estimateOneRepMax(parsed.weightKg, parsed.reps),
      achieved_at_ms: startedAtMs,
      fingerprint: set.fingerprint,
      rules_version: GROUP_EVAL_RULES_VERSION,
    };
  });
};
