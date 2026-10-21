import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import {
  SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';

export const normalizeExerciseSearchWords = (value: string): string[] =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);

export const indexExerciseCatalogMuscleGroupsById = (
  muscleGroups: ExerciseCatalogMuscleGroup[]
): Record<string, ExerciseCatalogMuscleGroup> =>
  muscleGroups.reduce<Record<string, ExerciseCatalogMuscleGroup>>((indexed, muscleGroup) => {
    indexed[muscleGroup.id] = muscleGroup;
    return indexed;
  }, {});

export type IndexedExerciseCatalogExercise = ExerciseCatalogExercise & {
  searchText: string;
};

export const buildExerciseCatalogSearchText = (
  exercise: Pick<ExerciseCatalogExercise, 'name' | 'mappings'>,
  muscleGroupsById: Record<string, ExerciseCatalogMuscleGroup>
): string => {
  const muscleTerms = exercise.mappings.flatMap((mapping) => {
    if (mapping.role !== 'primary') {
      return [];
    }

    const matchedMuscleGroup = muscleGroupsById[mapping.muscleGroupId];
    if (!matchedMuscleGroup) {
      return [];
    }

    return [matchedMuscleGroup.displayName, matchedMuscleGroup.familyName];
  });

  return [exercise.name, ...muscleTerms].join(' ').toLowerCase();
};

export const exerciseSearchTextMatches = (words: string[], searchText: string): boolean => {
  if (words.length === 0) {
    return true;
  }
  return words.every((word) => searchText.includes(word));
};

/**
 * Muscle search terms of a bundled-catalogue exercise, by its seed id. Group
 * exercises and catalogue seeds carry only a source id, so their searches
 * match on the origin exercise's muscle groups.
 */
export const seedMuscleSearchTermsById: ReadonlyMap<string, string> = (() => {
  const seedMuscleGroupsById = new Map(SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => [seed.id, seed]));
  const termsById = new Map<string, string[]>();
  for (const mapping of SYSTEM_EXERCISE_MUSCLE_MAPPING_SEEDS) {
    if (mapping.role !== 'primary') {
      continue;
    }
    const muscleGroup = seedMuscleGroupsById.get(mapping.muscleGroupId);
    if (!muscleGroup) {
      continue;
    }
    const terms = termsById.get(mapping.exerciseDefinitionId) ?? [];
    terms.push(muscleGroup.displayName, muscleGroup.familyName);
    termsById.set(mapping.exerciseDefinitionId, terms);
  }
  return new Map([...termsById].map(([id, terms]) => [id, terms.join(' ').toLowerCase()]));
})();

export const filterExerciseCatalogExercises = (
  exercises: ExerciseCatalogExercise[],
  muscleGroupsById: Record<string, ExerciseCatalogMuscleGroup>,
  query: string
): ExerciseCatalogExercise[] => {
  const searchWords = normalizeExerciseSearchWords(query);
  if (searchWords.length === 0) {
    return exercises;
  }

  return exercises.filter((exercise) =>
    exerciseSearchTextMatches(searchWords, buildExerciseCatalogSearchText(exercise, muscleGroupsById))
  );
};

export const filterIndexedExerciseCatalogExercises = <T extends IndexedExerciseCatalogExercise>(
  indexed: T[],
  query: string
): T[] => {
  const searchWords = normalizeExerciseSearchWords(query);

  return indexed.filter((exercise) => exerciseSearchTextMatches(searchWords, exercise.searchText));
};
