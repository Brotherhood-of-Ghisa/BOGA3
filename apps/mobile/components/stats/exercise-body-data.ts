import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import type { ProgressMuscleComparison } from '@/src/data/progress-comparisons';
import { exerciseCountedMuscles } from '@/src/exercise-catalog/exercise-muscles';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';
import type { ComparisonPeriodFigures, ComparisonRow } from './comparison-columns';

export type ExerciseBodyItem = ComparisonRow & {
  id: string;
  name: string;
  lastCompletedAt: Date | null;
};
export type ExerciseContributionEntry = { item: ExerciseBodyItem };
export type ExerciseBodyMuscleDetail = {
  muscleGroupId: string;
  displayName: string;
  exercises: ExerciseContributionEntry[];
  secondary: ExerciseContributionEntry[];
};

type Input = {
  items: readonly ExerciseBodyItem[];
  exercises: readonly Pick<ExerciseCatalogExercise, 'id' | 'mappings'>[];
  muscles: readonly ProgressMuscleComparison[];
  /** `false` drops secondary work ([[muscle.secondary-filter]]); unset counts it by [[muscle.set-count]]. */
  countSecondary?: boolean;
};

const countedMapping = (exercise: Pick<ExerciseCatalogExercise, 'id' | 'mappings'>, muscleGroupId: string, countSecondary: boolean) => {
  const mapping = exerciseCountedMuscles(exercise).find(entry => entry.muscleGroupId === muscleGroupId);
  return mapping && (countSecondary || mapping.role === 'primary') ? mapping : undefined;
};

/** Shades the 3D body in Exercise view from the filtered exercises (primary = 1, secondary = 0.5). */
export function buildExerciseBodyMuscles({ items, exercises, muscles, countSecondary = true }: Input): ProgressMuscleComparison[] {
  const definitions = new Map(exercises.map(exercise => [exercise.id, exercise]));
  return muscles.map(muscle => {
    const currentPeriods: ComparisonPeriodFigures[] = [];
    const previousPeriods: ComparisonPeriodFigures[] = [];
    for (const item of items) {
      const exercise = definitions.get(item.id);
      if (!exercise) continue;
      const mapping = countedMapping(exercise, muscle.muscleGroupId, countSecondary);
      if (!mapping) continue;
      currentPeriods.push(mapping.role === 'primary' ? item.current : halfPeriod(item.current));
      previousPeriods.push(mapping.role === 'primary' ? item.previous : halfPeriod(item.previous));
    }
    return { ...muscle, current: sumPeriods(currentPeriods), previous: sumPeriods(previousPeriods) };
  });
}

/** Scopes the Exercise list to a selected muscle on the 3D body, preserving primary and half-weight secondary work. */
export function buildExerciseBodyMuscle({
  muscleGroupId, items, exercises, muscles, countSecondary = true,
}: Input & { muscleGroupId: string | null }): ExerciseBodyMuscleDetail | null {
  if (!muscleGroupId) return null;
  const muscle = muscles.find(row => row.muscleGroupId === muscleGroupId);
  if (!muscle) return null;
  const definitions = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const primary: ExerciseContributionEntry[] = [];
  const secondaryItems: ExerciseContributionEntry[] = [];
  for (const item of items) {
    const exercise = definitions.get(item.id);
    if (!exercise) continue;
    const mapping = countedMapping(exercise, muscle.muscleGroupId, countSecondary);
    if (mapping?.role === 'primary') primary.push({ item });
    else if (mapping?.role === 'secondary') secondaryItems.push({
      item: { ...item, current: halfPeriod(item.current), previous: halfPeriod(item.previous) },
    });
  }
  return { muscleGroupId: muscle.muscleGroupId, displayName: muscle.displayName, exercises: primary, secondary: secondaryItems };
}

const halfPeriod = (period: ComparisonPeriodFigures): ComparisonPeriodFigures => ({
  workingSetCount: period.workingSetCount * .5,
  totalVolume: period.totalVolume === null || !Number.isFinite(period.totalVolume) ? null : period.totalVolume * .5,
  volumeSetCount: period.volumeSetCount,
});
const sumPeriods = (periods: ComparisonPeriodFigures[]): ComparisonPeriodFigures & { volumeSetCount: number } => periods.reduce<ComparisonPeriodFigures & { volumeSetCount: number }>((sum, period) => ({
  workingSetCount: sum.workingSetCount + period.workingSetCount,
  totalVolume: addFiniteVolume(sum.totalVolume, period.totalVolume),
  volumeSetCount: sum.volumeSetCount + (period.volumeSetCount ?? 0),
}), { workingSetCount: 0, totalVolume: 0, volumeSetCount: 0 });
