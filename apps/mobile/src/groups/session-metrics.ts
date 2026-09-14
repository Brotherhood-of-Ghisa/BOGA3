// Stream-card metrics and the friend view's performed sets, computed on the
// viewing device from the raw set rows the group reads return
// (`docs/specs/tech/groups-contract.md` §5). "Performed" and the parsed numbers
// come from `parseGroupPerformedSet` (`set-facts.ts`), the same rule the
// server-side evaluator runs, so no set semantics are restated here or in SQL.

import { computeSetVolume } from '@/src/exercise-calculations';

import { parseGroupPerformedSet } from './set-facts';
import type { GroupSessionExercise, GroupSessionSet } from './types';

export type GroupPerformedSet = {
  setId: string;
  orderIndex: number;
  weightKg: number;
  reps: number;
  setType: string | null;
};

export type GroupPerformedExercise = {
  sessionExerciseId: string;
  name: string;
  machineName: string | null;
  orderIndex: number;
  sets: GroupPerformedSet[];
};

export type GroupSessionMetrics = {
  performedSets: number;
  totalVolumeKg: number;
  exerciseCount: number;
};

/**
 * A confirmed performed set with its parsed kg and reps, else null. A blank
 * weight with valid reps is 0 kg (the recorder's canonicalization); a value the
 * recorder's input cannot produce (for example `1e3`) is not performed.
 */
export const toGroupPerformedSet = (set: GroupSessionSet): GroupPerformedSet | null => {
  const parsed = parseGroupPerformedSet(set);
  if (parsed === null) {
    return null;
  }
  return {
    setId: set.set_id,
    orderIndex: set.order_index,
    weightKg: parsed.weightKg,
    reps: parsed.reps,
    setType: set.set_type,
  };
};

/** Exercises with their performed sets, in server order; an exercise with none is omitted. */
export const selectGroupPerformedExercises = (exercises: GroupSessionExercise[]): GroupPerformedExercise[] =>
  exercises.flatMap((exercise) => {
    const sets = exercise.sets.flatMap((set) => toGroupPerformedSet(set) ?? []);
    if (sets.length === 0) {
      return [];
    }
    return [
      {
        sessionExerciseId: exercise.session_exercise_id,
        name: exercise.name,
        machineName: exercise.machine_name,
        orderIndex: exercise.order_index,
        sets,
      },
    ];
  });

/**
 * Card metrics: the performed-set count, Σ weight × reps over performed sets
 * (warm-ups included; the entered kg, no per-side normalization), and the
 * exercises with at least one performed set.
 */
export const computeGroupSessionMetrics = (exercises: GroupSessionExercise[]): GroupSessionMetrics => {
  const performed = selectGroupPerformedExercises(exercises);
  let performedSets = 0;
  let totalVolumeKg = 0;
  for (const exercise of performed) {
    for (const set of exercise.sets) {
      performedSets += 1;
      totalVolumeKg += computeSetVolume(set.weightKg, set.reps);
    }
  }
  return { performedSets, totalVolumeKg, exerciseCount: performed.length };
};
