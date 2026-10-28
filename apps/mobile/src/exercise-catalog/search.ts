import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import {
  STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS,
  SYSTEM_MUSCLE_GROUP_SEEDS,
} from '@/src/data/exercise-catalog-seeds';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';

import { reportedMappings, type MuscleSetup } from './muscle-setup';

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

/**
 * What an exercise search matches: the exercise name and its primary muscles'
 * names and families. Given the user's assignment, those are the user's muscles
 * (looked up in `muscleGroupsById` by muscle id), so no entry inside a merged
 * muscle and no untracked muscle matches ([[muscle.no-breakdown]]).
 */
export const buildExerciseCatalogSearchText = (
  exercise: Pick<ExerciseCatalogExercise, 'name' | 'mappings'>,
  muscleGroupsById: Record<string, Pick<ExerciseCatalogMuscleGroup, 'displayName' | 'familyName'>>,
  assignment?: MuscleReportAssignment
): string => {
  const mappings = assignment ? reportedMappings(exercise.mappings, assignment) : exercise.mappings;
  const muscleTerms = mappings.flatMap((mapping) => {
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

const SEED_MUSCLE_GROUPS_BY_ID = new Map(SYSTEM_MUSCLE_GROUP_SEEDS.map((seed) => [seed.id, seed]));

/** The anatomy entries each bundled-catalogue exercise maps as primary, by its seed id. */
const SEED_PRIMARY_ENTRY_IDS_BY_ID: ReadonlyMap<string, readonly string[]> = (() => {
  const entryIdsById = new Map<string, string[]>();
  for (const mapping of STANDARD_EXERCISE_MUSCLE_MAPPING_SEEDS) {
    if (mapping.role !== 'primary') continue;
    entryIdsById.set(mapping.exerciseDefinitionId, [...(entryIdsById.get(mapping.exerciseDefinitionId) ?? []), mapping.muscleGroupId]);
  }
  return entryIdsById;
})();

/**
 * Muscle search terms of a bundled-catalogue exercise, by its seed id. Group
 * exercises and catalogue seeds carry only a source id, so their searches
 * match on the origin exercise's primary muscles, read through the user's
 * muscle setup as every other search is ([[muscle.no-breakdown]]): an entry
 * matches by its muscle's name and family, an untracked one not at all. An
 * entry the user has no row for keeps the catalogue's name.
 */
export const seedMuscleSearchTerms = (seedId: string, muscleSetup: Pick<MuscleSetup, 'assignment'>): string =>
  (SEED_PRIMARY_ENTRY_IDS_BY_ID.get(seedId) ?? [])
    .flatMap((entryId) => {
      const assigned = muscleSetup.assignment.get(entryId);
      if (assigned) return assigned.tracked ? [assigned.muscle.displayName, assigned.muscle.familyName] : [];
      const seed = SEED_MUSCLE_GROUPS_BY_ID.get(entryId);
      return seed ? [seed.displayName, seed.familyName] : [];
    })
    .join(' ')
    .toLowerCase();

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
