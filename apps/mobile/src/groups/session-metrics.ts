// Personal/as-logged metrics for shared-session cards and detail. Group rules
// are deliberately absent: ranked scores use performance-score.ts instead.
import { isValidSessionWeight } from '@/src/bodyweight/snapshot';
import { parseSetWeight } from '@/src/exercise-calculations';
import {
  calculateEffectiveSetMetrics, isWeightUnit, summarizeEffectiveVolume, weightToKg,
  type EffectiveSetMetrics, type LoadContext, type VolumeCoverage,
} from '@/src/exercise-calculations/effective-load';
import { canonicalizeWeightForReps } from '@/src/session-recorder/set-semantics';
import type { GroupSessionExercise, GroupSessionLoadContext, GroupSessionSet } from './types';

export type GroupPerformedSet = {
  setId: string;
  orderIndex: number;
  /** Original amount/unit for the visible row; never replace it with resistance. */
  enteredWeight: number;
  weightUnit: string | null;
  weightKg: number | null;
  externalLoadMode: string | null;
  reps: number;
  setType: string | null;
  metrics: EffectiveSetMetrics;
};
export type GroupPerformedExercise = {
  sessionExerciseId: string;
  name: string;
  machineName: string | null;
  orderIndex: number;
  loadContext: LoadContext;
  sets: GroupPerformedSet[];
};
export type GroupSessionMetrics = {
  performedSets: number;
  /** Null when any performed set lacks valid load context. */
  totalVolumeKg: number | null;
  exerciseCount: number;
  coverage: VolumeCoverage;
  basis: 'personal' | 'legacy_entered_load';
};

const legacyContext: LoadContext = { bodyweightCoefficient: 0, loadInputMode: 'total_load' };

/** A v2 payload with absent definition metadata is unknown, never c=0. */
export const groupSessionWeightSnapshot = (session: GroupSessionLoadContext) => ({
  bodyWeightKg: session.body_weight_kg ?? null,
  bodyWeightSource: session.body_weight_source ?? null,
  bodyWeightMeasurementId: session.body_weight_measurement_id ?? null,
  bodyWeightMeasuredAt: session.body_weight_measured_at_ms == null ? null : new Date(session.body_weight_measured_at_ms),
});

export function groupSessionExerciseLoadContext(
  exercise: GroupSessionExercise, session?: GroupSessionLoadContext,
): LoadContext {
  if (session?.metric_revision !== 'dated_added_load_v3') return legacyContext;
  const snapshot = groupSessionWeightSnapshot(session);
  const absent = Object.values(snapshot).every(value => value === null);
  return {
    bodyweightCoefficient: exercise.bodyweight_coefficient ?? NaN,
    loadInputMode: exercise.load_input_mode ?? '',
    // The kernel distinguishes a missing tuple from malformed provenance.
    bodyWeightKg: isValidSessionWeight(snapshot) ? snapshot.bodyWeightKg : absent ? null : NaN,
  };
}

/** Preserve performed rows even when only load-dependent metrics are unavailable. */
export function toGroupPerformedSet(
  set: GroupSessionSet, context: LoadContext = legacyContext, requireMetadata = false,
): GroupPerformedSet | null {
  if (set.performance_status !== null) return null;
  const weight = canonicalizeWeightForReps(set.weight_value, set.reps_value);
  const enteredWeight = parseSetWeight(weight);
  const weightUnit = set.weight_unit === undefined ? requireMetadata ? null : 'kg' : set.weight_unit;
  const metrics = calculateEffectiveSetMetrics({ ...context, weightValue: weight,
    repsValue: set.reps_value, weightUnit, externalLoadMode: set.external_load_mode,
    performanceStatus: null, setType: set.set_type });
  if (!metrics.eligible || enteredWeight === null) return null;
  return { setId: set.set_id, orderIndex: set.order_index, enteredWeight, weightUnit,
    weightKg: isWeightUnit(weightUnit) ? weightToKg(enteredWeight, weightUnit) : null,
    externalLoadMode: set.external_load_mode ?? null, reps: metrics.reps, setType: set.set_type, metrics };
}

export function selectGroupPerformedExercises(
  exercises: GroupSessionExercise[], session?: GroupSessionLoadContext,
): GroupPerformedExercise[] {
  return exercises.flatMap(exercise => {
    const loadContext = groupSessionExerciseLoadContext(exercise, session);
    const sets = exercise.sets.flatMap(set =>
      toGroupPerformedSet(set, loadContext, session?.metric_revision === 'dated_added_load_v3') ?? []);
    return sets.length ? [{ sessionExerciseId: exercise.session_exercise_id, name: exercise.name,
      machineName: exercise.machine_name, orderIndex: exercise.order_index, loadContext, sets }] : [];
  });
}

export function computeGroupSessionMetrics(
  exercises: GroupSessionExercise[], session?: GroupSessionLoadContext,
): GroupSessionMetrics {
  const performed = selectGroupPerformedExercises(exercises, session);
  const coverage = summarizeEffectiveVolume(performed.flatMap(exercise => exercise.sets.map(set => set.metrics)));
  return { performedSets: coverage.eligibleSetCount, totalVolumeKg: coverage.totalVolumeKgReps,
    exerciseCount: performed.length, coverage,
    basis: session?.metric_revision === 'dated_added_load_v3' ? 'personal' : 'legacy_entered_load' };
}
