import {
  buildExerciseCatalogSearchText,
  exerciseSearchTextMatches,
  filterExerciseCatalogExercises,
  indexExerciseCatalogMuscleGroupsById,
  normalizeExerciseSearchWords,
} from '@/src/exercise-catalog/search';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';
import { buildMuscleSetup } from '@/src/exercise-catalog/muscle-setup';

import { broadMuscleRows, detailedMuscleRows } from './helpers/muscle-setup';

const muscleGroups: ExerciseCatalogMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0, reportGroup: null, tracked: 1 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1, reportGroup: null, tracked: 1 },
  { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2, reportGroup: null, tracked: 1 },
  { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3, reportGroup: null, tracked: 1 },
  { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 4, reportGroup: null, tracked: 1 },
];

const exercises: ExerciseCatalogExercise[] = [
  {
    id: 'exercise-bench',
    name: 'Bench Press',
    bodyweightContribution: 0,
    splitByGym: false,
    deletedAt: null,
    mappings: [
      { id: 'map-bench-primary', muscleGroupId: 'chest', weight: 1, role: 'primary' },
      { id: 'map-bench-secondary', muscleGroupId: 'triceps', weight: 0.5, role: 'secondary' },
    ],
  },
  {
    id: 'exercise-squat',
    name: 'Barbell Squat',
    bodyweightContribution: 0,
    splitByGym: false,
    deletedAt: null,
    mappings: [{ id: 'map-squat', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
  },
  {
    id: 'exercise-deadlift',
    name: 'Deadlift',
    bodyweightContribution: 0,
    splitByGym: false,
    deletedAt: null,
    mappings: [{ id: 'map-deadlift', muscleGroupId: 'back', weight: 1, role: 'primary' }],
  },
  {
    id: 'exercise-overhead-press',
    name: 'Overhead Press',
    bodyweightContribution: 0,
    splitByGym: false,
    deletedAt: null,
    mappings: [{ id: 'map-overhead-press', muscleGroupId: 'delts_front', weight: 1, role: 'primary' }],
  },
];

const filterExerciseIds = (query: string) =>
  filterExerciseCatalogExercises(exercises, indexExerciseCatalogMuscleGroupsById(muscleGroups), query).map(
    (exercise) => exercise.id
  );

describe('exercise catalog search', () => {
  it('matches all query words across exercise names and primary muscle display/family terms only', () => {
    expect(filterExerciseIds('')).toEqual([
      'exercise-bench',
      'exercise-squat',
      'exercise-deadlift',
      'exercise-overhead-press',
    ]);
    expect(filterExerciseIds('  CHEST bench ')).toEqual(['exercise-bench']);
    expect(filterExerciseIds('  front press ')).toEqual(['exercise-overhead-press']);
    expect(filterExerciseIds('   squAT   press  ')).toEqual([]);
    expect(filterExerciseIds('triceps')).toEqual([]);
    expect(filterExerciseIds('delts_front')).toEqual([]);
  });
});

describe("exercise search in the user's muscles ([[muscle.no-breakdown]])", () => {
  const broad = buildMuscleSetup(broadMuscleRows());
  const detailed = buildMuscleSetup(detailedMuscleRows());
  const exercisePrimaryFor = (muscleGroupId: string): ExerciseCatalogExercise => ({
    id: `exercise-${muscleGroupId}`,
    name: 'Exercise',
    bodyweightContribution: 0,
    splitByGym: false,
    deletedAt: null,
    mappings: [{ id: `map-${muscleGroupId}`, muscleGroupId, weight: 1, role: 'primary' }],
  });
  const matches = (query: string, muscleGroupId: string, setup = broad) => exerciseSearchTextMatches(
    normalizeExerciseSearchWords(query),
    buildExerciseCatalogSearchText(exercisePrimaryFor(muscleGroupId), setup.musclesById, setup.assignment),
  );

  it('offers the 11 Broad muscles, and every catalogue entry under Detailed', () => {
    expect(broad.muscles.map((muscle) => muscle.displayName)).toEqual([
      'Chest', 'Front Delts', 'Lateral Delts', 'Rear Delts', 'Back', 'Biceps', 'Triceps', 'Core', 'Quads',
      'Glutes & Hams', 'Calves',
    ]);
    expect(detailed.muscles.map((muscle) => muscle.id).sort()).toEqual(detailedMuscleRows().map((row) => row.id).sort());
  });

  it('matches a merged muscle by its name, never an entry name inside it or an untracked entry', () => {
    expect(matches('back', 'traps_lower')).toBe(true);
    expect(matches('glutes hams', 'hamstrings')).toBe(true);
    expect(matches('chest', 'serratus_anterior')).toBe(true);
    for (const entry of detailedMuscleRows()) {
      const muscle = broad.assignment.get(entry.id);
      if (muscle?.tracked && muscle.muscle.displayName === entry.displayName) continue;
      expect([entry.displayName, matches(entry.displayName, entry.id)]).toEqual([entry.displayName, false]);
      expect(matches(entry.displayName, entry.id, detailed)).toBe(true);
    }
  });
});
