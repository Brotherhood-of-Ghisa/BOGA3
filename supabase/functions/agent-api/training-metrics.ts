// Owner-filtered database rows enter here. This adapter contains no new maths:
// mobile and coaching share the same eligibility, dated context and load boundary.
import {
  exerciseLoadContext, summarizeExerciseLoad,
} from '../../../apps/mobile/src/exercise-calculations/analytics.ts';
import {
  isWeightUnit, weightToKg, type VolumeCoverage,
} from '../../../apps/mobile/src/exercise-calculations/effective-load.ts';
import { parseSetWeight } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import {
  canonicalizeWeightForReps, type SessionSetPerformanceStatus,
} from '../../../apps/mobile/src/session-recorder/set-semantics.ts';
import {
  isValidSessionWeight, type SessionWeightSnapshot,
} from '../../../apps/mobile/src/bodyweight/snapshot.ts';

export const METRIC_REVISION = 'dated_added_load_v3';

export type ExerciseLoadRow = {
  bodyweight_coefficient: number;
  load_input_mode: string;
  movement_standard: string | null;
  loading_method: string | null;
};
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
  weight_unit: string;
  external_load_mode: string | null;
  reps_value: string;
  set_type: string | null;
  performance_status: string | null;
};

const snapshotFor = (row: SessionWeightRow): SessionWeightSnapshot => ({
  bodyWeightKg: row.body_weight_kg,
  bodyWeightSource: row.body_weight_source,
  bodyWeightMeasurementId: row.body_weight_measurement_id,
  bodyWeightMeasuredAt: row.body_weight_measured_at === null
    ? null : new Date(row.body_weight_measured_at),
});

export function sessionWeightPayload(row: SessionWeightRow) {
  const snapshot = snapshotFor(row);
  const valid = isValidSessionWeight(snapshot);
  const empty = Object.values(snapshot).every(value => value === null);
  return {
    status: valid ? 'known' : empty ? 'missing' : 'invalid',
    value: valid ? snapshot.bodyWeightKg : null,
    unit: 'kg',
    source: snapshot.bodyWeightSource,
    measurement_id: snapshot.bodyWeightMeasurementId,
    measured_at: snapshot.bodyWeightMeasuredAt && Number.isFinite(snapshot.bodyWeightMeasuredAt.getTime())
      ? snapshot.bodyWeightMeasuredAt.toISOString() : null,
    estimated: false,
  };
}

export function exerciseLoadPayload(row: ExerciseLoadRow) {
  return {
    bodyweight_coefficient: row.bodyweight_coefficient,
    load_input_mode: row.load_input_mode,
    movement_standard: row.movement_standard,
    loading_method: row.loading_method,
    resistance_basis: row.bodyweight_coefficient > 0 ? 'total_resistance' : 'entered_load',
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
) {
  // A missing/deleted definition cannot silently establish conventional rules.
  const context = exerciseLoadContext(definition ? {
    bodyweightCoefficient: definition.bodyweight_coefficient,
    loadInputMode: definition.load_input_mode,
  } : { localBodyweightMetadataKnown: false }, snapshotFor(session));
  const summary = summarizeExerciseLoad(sets.map(set => ({
    weightValue: set.weight_value, weightUnit: set.weight_unit,
    externalLoadMode: set.external_load_mode, repsValue: set.reps_value,
    setType: set.set_type,
    // Every non-null wire status is ineligible, including unknown future values.
    performanceStatus: set.performance_status === null ? null : set.performance_status as SessionSetPerformanceStatus,
  })), context);
  return {
    ...summary,
    sets: sets.flatMap((set, index) => {
      const metric = summary.metrics[index];
      if (!metric.eligible) return [];
      const amount = parseSetWeight(canonicalizeWeightForReps(set.weight_value, set.reps_value));
      const kg = amount !== null && isWeightUnit(set.weight_unit) ? weightToKg(amount, set.weight_unit) : null;
      return [{
        id: set.id, order_index: set.order_index,
        // The existing load field keeps its kg external-amount meaning.
        load: kg === null ? null : { value: kg, unit: 'kg' },
        entered_load: { raw_value: set.weight_value, value: amount, unit: set.weight_unit, mode: 'added' },
        reps: metric.reps, set_type: set.set_type, performance_status: set.performance_status,
        outcome: 'completed',
        effective_load: {
          status: metric.load.status,
          reason: metric.load.status === 'known' ? null : metric.load.reason,
          value: metric.load.status === 'known' ? metric.load.resistanceKg : null,
          unit: 'kg',
          basis: metric.load.status === 'known' ? metric.load.resistanceBasis : null,
        },
        estimated_one_rep_max: metric.estimatedOneRepMaxKg === null
          ? null : { value: metric.estimatedOneRepMaxKg, unit: 'kg', basis: context.bodyweightCoefficient > 0 ? 'added_load' : 'entered_load' },
        volume: { value: metric.volumeKgReps, unit: 'kg_reps' },
      }];
    }),
  };
}
