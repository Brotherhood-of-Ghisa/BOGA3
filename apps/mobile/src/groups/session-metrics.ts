// Shared-session cards use ordinary kg math. Private settings, contributions,
// and readings never cross the group boundary; ranked group scores are
// calculated server-side under group-owned rules.
import { parseSetWeight } from '@/src/exercise-calculations';
import {
  calculateSetMetrics, summarizeVolume,
  type LoadContext, type SetMetrics, type VolumeCoverage,
} from '@/src/exercise-calculations/load-metrics';
import { ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { canonicalizeWeightForReps, isWorkingSetType } from '@/src/exercise-calculations/set-semantics';
import type { GroupSessionExercise, GroupSessionSet } from './types';

export type GroupPerformedSet = {
  setId: string;
  orderIndex: number;
  /** Raw entered kg for the visible row. */
  enteredWeight: number;
  weightKg: number;
  reps: number;
  setType: string | null;
  metrics: SetMetrics;
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
  /** `Sets`: the performed working sets (`ux-rules.md` §5.11). */
  workingSets: number;
  /** Working sets only; null only when a working row is invalid. */
  totalVolumeKg: number | null;
  exerciseCount: number;
  /** Volume coverage over the working sets. */
  coverage: VolumeCoverage;
};

export function groupSessionExerciseLoadContext(
  exercise: GroupSessionExercise,
): LoadContext {
  return ordinaryLoadContext(
    exercise.load_input_mode === 'per_side_load' ? 'per_side_load' : 'total_load',
  );
}

/** Preserve performed rows even when only load-dependent metrics are unavailable. */
export function toGroupPerformedSet(
  set: GroupSessionSet, context: LoadContext = ordinaryLoadContext(),
): GroupPerformedSet | null {
  if (set.performance_status !== null) return null;
  const weight = canonicalizeWeightForReps(set.weight_value, set.reps_value);
  const enteredWeight = parseSetWeight(weight);
  const metrics = calculateSetMetrics({ ...context, weightValue: weight,
    repsValue: set.reps_value,
    performanceStatus: null, setType: set.set_type });
  if (!metrics.eligible || enteredWeight === null) return null;
  return { setId: set.set_id, orderIndex: set.order_index, enteredWeight,
    weightKg: enteredWeight, reps: metrics.reps, setType: set.set_type, metrics };
}

export function selectGroupPerformedExercises(
  exercises: GroupSessionExercise[],
): GroupPerformedExercise[] {
  return exercises.flatMap(exercise => {
    const loadContext = groupSessionExerciseLoadContext(exercise);
    const sets = exercise.sets.flatMap(set =>
      toGroupPerformedSet(set, loadContext) ?? []);
    return sets.length ? [{ sessionExerciseId: exercise.session_exercise_id, name: exercise.name,
      machineName: exercise.machine_name, orderIndex: exercise.order_index, loadContext, sets }] : [];
  });
}

export function computeGroupSessionMetrics(
  exercises: GroupSessionExercise[],
): GroupSessionMetrics {
  const performed = selectGroupPerformedExercises(exercises);
  const sets = performed.flatMap(exercise => exercise.sets);
  const working = sets.filter(set => isWorkingSetType(set.setType));
  const coverage = summarizeVolume(working.map(set => set.metrics));
  return { workingSets: working.length, totalVolumeKg: coverage.totalVolumeKgReps,
    exerciseCount: performed.length, coverage };
}
