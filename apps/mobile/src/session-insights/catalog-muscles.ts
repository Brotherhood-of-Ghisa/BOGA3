import { applyMuscleReport, type MuscleReportAssignment } from '@/src/data/muscle-analytics';
import { getPersonalMuscleCounting, type MuscleCountingPolicy } from '@/src/config/personal-muscles';

import type {
  SessionInsightExerciseDefinition,
  SessionInsightMuscleGroup,
  SessionInsightMuscleMapping,
} from './calculations';

/** The catalogue as the session views read it: mappings and groups already keyed by the user's muscles. */
export type SessionMuscleCatalog = MuscleCountingPolicy & {
  exerciseDefinitions: SessionInsightExerciseDefinition[];
  muscleMappings: SessionInsightMuscleMapping[];
  muscleGroups: SessionInsightMuscleGroup[];
};

type CatalogExercise = {
  id: string;
  loadInputMode?: SessionInsightExerciseDefinition['loadInputMode'] | null;
  bodyweightContribution: number;
  mappings: readonly Omit<SessionInsightMuscleMapping, 'exerciseDefinitionId'>[];
};

/**
 * Anatomy mappings and entries read through the user's muscle setup
 * ([[muscle.report-groups]]), so the completed-session breakdown, the by-muscle
 * comparison and live insights all report the same muscles. Detailed returns
 * their allocated figures unchanged.
 */
export const reportSessionMuscles = (
  catalog: Pick<SessionMuscleCatalog, 'muscleMappings' | 'muscleGroups'>,
  assignment: MuscleReportAssignment,
): Pick<SessionMuscleCatalog, 'muscleMappings' | 'muscleGroups'> & MuscleCountingPolicy => {
  const { muscleMappings, muscleGroups } = applyMuscleReport(
    { sessions: [], sessionExercises: [], exerciseSets: [], ...catalog },
    assignment,
  );
  return { muscleMappings, muscleGroups, ...getPersonalMuscleCounting() };
};

/** `reportSessionMuscles` over the exercise catalogue cache's exercises and entries. */
export const sessionMuscleCatalogOfExercises = (
  exercises: readonly CatalogExercise[],
  muscleGroups: SessionInsightMuscleGroup[],
  assignment: MuscleReportAssignment,
): SessionMuscleCatalog => ({
  exerciseDefinitions: exercises.map((exercise) => ({
    id: exercise.id,
    loadInputMode: exercise.loadInputMode ?? 'total_load',
    bodyweightContribution: exercise.bodyweightContribution,
  })),
  ...reportSessionMuscles({
    muscleMappings: exercises.flatMap((exercise) =>
      exercise.mappings.map((mapping) => ({
        exerciseDefinitionId: exercise.id,
        muscleGroupId: mapping.muscleGroupId,
        role: mapping.role,
        weight: mapping.weight,
      }))),
    muscleGroups,
  }, assignment),
});
