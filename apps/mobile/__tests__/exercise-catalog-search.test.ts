import {
  filterExerciseCatalogExercises,
  indexExerciseCatalogMuscleGroupsById,
} from '@/src/exercise-catalog/search';
import type { ExerciseCatalogExercise, ExerciseCatalogMuscleGroup } from '@/src/data/exercise-catalog';

const muscleGroups: ExerciseCatalogMuscleGroup[] = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 0 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 1 },
  { id: 'delts_front', displayName: 'Front Delts', familyName: 'Shoulders', sortOrder: 2 },
  { id: 'quads', displayName: 'Quads', familyName: 'Legs', sortOrder: 3 },
  { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 4 },
];

const exercises: ExerciseCatalogExercise[] = [
  {
    id: 'exercise-bench',
    name: 'Bench Press',
    bodyweightContribution: 0,
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
    deletedAt: null,
    mappings: [{ id: 'map-squat', muscleGroupId: 'quads', weight: 1, role: 'primary' }],
  },
  {
    id: 'exercise-deadlift',
    name: 'Deadlift',
    bodyweightContribution: 0,
    deletedAt: null,
    mappings: [{ id: 'map-deadlift', muscleGroupId: 'back', weight: 1, role: 'primary' }],
  },
  {
    id: 'exercise-overhead-press',
    name: 'Overhead Press',
    bodyweightContribution: 0,
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
