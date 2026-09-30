// Owner-filtered database rows enter here. This adapter contains no new maths:
// mobile and coaching share the same eligibility, dated context and load boundary.
import {
  personalLoadContext, summarizeExerciseLoad,
} from '../../../apps/mobile/src/exercise-calculations/analytics.ts';
import type { VolumeCoverage } from '../../../apps/mobile/src/exercise-calculations/load-metrics.ts';
import { parseSetWeight } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import {
  canonicalizeWeightForReps, type SessionSetPerformanceStatus,
} from '../../../apps/mobile/src/session-recorder/set-semantics.ts';
import {
  isValidSessionWeight, type ResolvedSessionWeight,
} from '../../../apps/mobile/src/bodyweight/as-of.ts';

export const METRIC_REVISION = 'bodyweight_optional_v1';

export type ExerciseLoadRow = {
  bodyweight_contribution: number;
  load_input_mode: string;
};
/** Snake-case result of `session_weight_contexts`; adapted immediately to the shared domain type. */
export type SessionWeightRow = {
  body_weight_kg: number | null;
  body_weight_source: string | null;
  body_weight_measurement_id: string | null;
  body_weight_measured_at: number | null;
};
export type EnteredSetRow = {
  id: string;
  order_index: number;
  weight_value: string;
  reps_value: string;
  set_type: string | null;
  performance_status: string | null;
};

const contextFor = (row: SessionWeightRow): ResolvedSessionWeight => ({
  bodyWeightKg: row.body_weight_kg,
  bodyWeightSource: row.body_weight_source === 'reading' ? 'reading' : null,
  bodyWeightMeasurementId: row.body_weight_measurement_id,
  bodyWeightMeasuredAt: row.body_weight_measured_at === null
    ? null : new Date(row.body_weight_measured_at),
});

export function sessionWeightPayload(row: SessionWeightRow) {
  const context = contextFor(row);
  const valid = isValidSessionWeight(context);
  const empty = Object.values(context).every(value => value === null);
  return {
    status: valid ? 'known' : empty ? 'missing' : 'invalid',
    value: valid ? context.bodyWeightKg : null,
    unit: 'kg',
    measured_at: context.bodyWeightMeasuredAt && Number.isFinite(context.bodyWeightMeasuredAt.getTime())
      ? context.bodyWeightMeasuredAt.toISOString() : null,
  };
}

export function exerciseLoadPayload(row: ExerciseLoadRow, calculationsEnabled: boolean) {
  return {
    load_input_mode: row.load_input_mode,
    ...(calculationsEnabled && row.bodyweight_contribution > 0
      ? { bodyweight_contribution: row.bodyweight_contribution }
      : {}),
  };
}

export function volumePayload(coverage: VolumeCoverage, inputTruncated = false) {
  return {
    value: inputTruncated ? null : coverage.totalVolumeKgReps,
    unit: 'kg_reps',
    known_subtotal: coverage.knownVolumeKgReps,
    complete: coverage.complete && !inputTruncated,
    eligible_set_count: coverage.eligibleSetCount,
    known_set_count: coverage.knownSetCount,
    missing_set_count: coverage.missingSetCount,
    invalid_set_count: coverage.invalidSetCount,
    overflow: coverage.overflow,
    input_truncated: inputTruncated,
  };
}

export function projectTrainingSets(
  sets: readonly EnteredSetRow[], definition: ExerciseLoadRow | null, session: SessionWeightRow,
  calculationsEnabled: boolean,
) {
  const bodyweightContribution = definition?.bodyweight_contribution ?? 0;
  const usesBodyweightContext = calculationsEnabled && bodyweightContribution > 0;
  const context = personalLoadContext(calculationsEnabled, definition ? {
    bodyweightContribution,
    loadInputMode: definition.load_input_mode === 'per_side_load' ? 'per_side_load' : 'total_load',
  } : null, usesBodyweightContext ? contextFor(session) : null);
  const summary = summarizeExerciseLoad(sets.map(set => ({
    weightValue: set.weight_value, repsValue: set.reps_value,
    setType: set.set_type,
    // Every non-null wire status is ineligible, including unknown future values.
    performanceStatus: set.performance_status === null ? null : set.performance_status as SessionSetPerformanceStatus,
  })), context);
  return {
    ...summary,
    usesBodyweightContext,
    sets: sets.flatMap((set, index) => {
      const metric = summary.metrics[index];
      if (!metric.eligible) return [];
      const amount = parseSetWeight(canonicalizeWeightForReps(set.weight_value, set.reps_value));
      return [{
        id: set.id, order_index: set.order_index,
        load: amount === null ? null : { value: amount, unit: 'kg' },
        reps: metric.reps, set_type: set.set_type, performance_status: set.performance_status,
        outcome: 'completed',
        calculated_load: {
          status: metric.load.status,
          reason: metric.load.status === 'known' ? null : metric.load.reason,
          value: metric.load.status === 'known' ? metric.load.calculatedLoadKg : null,
          unit: 'kg',
        },
        estimated_one_rep_max: metric.estimatedOneRepMaxKg === null
          ? null : { value: metric.estimatedOneRepMaxKg, unit: 'kg' },
        volume: { value: metric.volumeKgReps, unit: 'kg_reps' },
      }];
    }),
  };
}
