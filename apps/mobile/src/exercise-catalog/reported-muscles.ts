import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import { exerciseCountedMuscles, type ExerciseMuscle } from './exercise-muscles';
import { OTHER_EXERCISE_FAMILY, pickPrimaryExerciseMapping } from './list-model';
import { EMPTY_MUSCLE_SETUP, type MuscleSetup } from './muscle-setup';

/** Every anatomy entry is its own tracked muscle: today's Detailed view. */
export const NO_MUSCLE_REPORT: MuscleReportAssignment = EMPTY_MUSCLE_SETUP.assignment;

/**
 * An exercise's counted muscles as the user sees them ([[muscle.no-breakdown]]):
 * entries re-keyed to their muscle, each once at its strongest role (primary
 * is listed first), and muscles the user does not track left out.
 */
export const reportedExerciseMuscles = (
  exercise: Pick<ExerciseCatalogExercise, 'mappings'>, report: MuscleReportAssignment,
): ExerciseMuscle[] => {
  const muscles: ExerciseMuscle[] = [];
  const seen = new Set<string>();
  for (const { muscleGroupId, role } of exerciseCountedMuscles(exercise)) {
    const assigned = report.get(muscleGroupId);
    if (assigned?.tracked === false) continue;
    const id = assigned?.muscle.id ?? muscleGroupId;
    if (seen.has(id)) continue;
    seen.add(id);
    muscles.push({ muscleGroupId: id, role });
  }
  return muscles;
};

/**
 * The name of the muscle whose history `id` opens, or null when the user has no
 * such muscle: an entry merged into another's id, or one nothing tracked
 * backs. A merged muscle lives while any of its entries is tracked, so it is
 * read from the setup's muscles, not from its anchor entry. An id the setup
 * does not know is named by the catalogue.
 */
export const reportedMuscleName = (
  setup: MuscleSetup, catalogById: Readonly<Record<string, ExerciseCatalogMuscleGroup>>, id: string,
): string | null => {
  const muscle = setup.musclesById[id];
  if (muscle) return muscle.displayName;
  return setup.assignment.has(id) ? null : catalogById[id]?.displayName ?? null;
};

/**
 * The family an exercise sits under in a Progress list: its primary mapping's,
 * skipping muscles the user does not track. With none left it is Other.
 */
export const reportedPrimaryFamilyName = (
  exercise: ExerciseCatalogExercise, report: MuscleReportAssignment,
  catalogById: ReadonlyMap<string, ExerciseCatalogMuscleGroup>,
): string => {
  const mapping = pickPrimaryExerciseMapping({
    ...exercise, mappings: exercise.mappings.filter(candidate => report.get(candidate.muscleGroupId)?.tracked !== false),
  });
  if (!mapping) return OTHER_EXERCISE_FAMILY;
  return report.get(mapping.muscleGroupId)?.muscle.familyName
    ?? catalogById.get(mapping.muscleGroupId)?.familyName ?? OTHER_EXERCISE_FAMILY;
};
