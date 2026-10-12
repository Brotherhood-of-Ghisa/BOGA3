import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';

export type ExerciseMuscle = { muscleGroupId: string; role: 'primary' | 'secondary' };

/**
 * The muscles an exercise's sets count towards ([[muscle.set-count]]): its
 * primary muscles, then its secondaries, each once at its strongest role.
 * Stabilizer and unroled mappings count nothing, so they are left out.
 */
export const exerciseCountedMuscles = (exercise: Pick<ExerciseCatalogExercise, 'mappings'>): ExerciseMuscle[] => {
  const muscles: ExerciseMuscle[] = [];
  const seen = new Set<string>();
  for (const role of ['primary', 'secondary'] as const) {
    for (const mapping of exercise.mappings) {
      if (mapping.role !== role || seen.has(mapping.muscleGroupId)) continue;
      seen.add(mapping.muscleGroupId);
      muscles.push({ muscleGroupId: mapping.muscleGroupId, role });
    }
  }
  return muscles;
};
