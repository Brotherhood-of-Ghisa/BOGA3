import { aggregateExerciseCatalogStats, type ExerciseCatalogStatsRawHistory } from '@/src/data/exercise-catalog-stats';
import {
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  buildExerciseListModel,
  type ExerciseListPreferences,
} from '@/src/exercise-catalog/list-model';
import type { IndexedExerciseCatalogExercise } from '@/src/exercise-catalog/search';

const NOW = new Date('2026-06-24T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const rawHistory = (): ExerciseCatalogStatsRawHistory => ({
  sessions: [
    { id: 's-recent', completedAt: daysBefore(2) },
    { id: 's-mid', completedAt: daysBefore(45) },
    { id: 's-old', completedAt: daysBefore(120) },
    { id: 's-over-year', completedAt: daysBefore(380) },
  ],
  sessionExercises: [
    { id: 'se-bench-recent', sessionId: 's-recent', exerciseDefinitionId: 'bench' },
    { id: 'se-row-mid', sessionId: 's-mid', exerciseDefinitionId: 'row' },
    { id: 'se-curl-old', sessionId: 's-old', exerciseDefinitionId: 'curl' },
    { id: 'se-squat-over-year', sessionId: 's-over-year', exerciseDefinitionId: 'squat' },
  ],
  exerciseSets: [
    { sessionExerciseId: 'se-bench-recent', weightValue: '20', repsValue: '10', setType: 'warm_up' },
    { sessionExerciseId: 'se-bench-recent', weightValue: '100', repsValue: '5', setType: null },
    { sessionExerciseId: 'se-row-mid', weightValue: '80', repsValue: '8', setType: null },
    { sessionExerciseId: 'se-row-mid', weightValue: '', repsValue: '8', setType: null },
    { sessionExerciseId: 'se-curl-old', weightValue: '20', repsValue: '12', setType: null },
    { sessionExerciseId: 'se-squat-over-year', weightValue: '140', repsValue: '5', setType: null },
  ],
});

const exercises: IndexedExerciseCatalogExercise[] = [
  {
    id: 'bench',
    name: 'Bench Press',
    deletedAt: null,
    mappings: [{ id: 'm-bench', muscleGroupId: 'chest', weight: 1, role: 'primary' }],
    searchText: 'bench press chest chest',
  },
  {
    id: 'row',
    name: 'Cable Row',
    deletedAt: null,
    mappings: [{ id: 'm-row', muscleGroupId: 'back', weight: 1, role: 'primary' }],
    searchText: 'cable row lats back',
  },
  {
    id: 'curl',
    name: 'Curl',
    deletedAt: null,
    mappings: [{ id: 'm-curl', muscleGroupId: 'biceps', weight: 1, role: 'primary' }],
    searchText: 'curl biceps arms',
  },
  {
    id: 'never',
    name: 'Z Press',
    deletedAt: null,
    mappings: [{ id: 'm-never', muscleGroupId: 'delts', weight: 1, role: 'primary' }],
    searchText: 'z press delts shoulders',
  },
  {
    id: 'unmapped',
    name: 'Carry',
    deletedAt: null,
    mappings: [],
    searchText: 'carry',
  },
];

const muscleGroups = [
  { id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 10 },
  { id: 'delts', displayName: 'Delts', familyName: 'Shoulders', sortOrder: 20 },
  { id: 'back', displayName: 'Lats', familyName: 'Back', sortOrder: 30 },
  { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 40 },
];

const buildModel = (preferences: Partial<ExerciseListPreferences> = {}) =>
  buildExerciseListModel({
    exercises,
    muscleGroups,
    stats: aggregateExerciseCatalogStats(rawHistory(), preferences.dateRange ?? 90, NOW),
    preferences: { ...DEFAULT_EXERCISE_LIST_PREFERENCES, ...preferences },
    query: '',
    includeDeleted: false,
    showNeverDone: true,
  });

describe('exercise list model', () => {
  it('sorts recents by valid completed set score, then most recent use, then name', () => {
    const model = buildModel({ groupByMuscleFamily: false, dateRange: 90, recentsOnTop: true });

    expect(model.items.map((item) => item.id)).toEqual([
      'bench',
      'row',
      'unmapped',
      'curl',
      'never',
    ]);
    expect(model.items.find((item) => item.id === 'bench')?.recency?.completedSetCount).toBe(2);
    expect(model.items.find((item) => item.id === 'row')?.recency?.completedSetCount).toBe(1);
  });

  it('uses the selected finite scoring window and caps All recents at one year', () => {
    const sevenDay = buildModel({ groupByMuscleFamily: false, dateRange: 7, recentsOnTop: true });
    expect(sevenDay.items.map((item) => item.id)).toEqual([
      'bench',
      'row',
      'unmapped',
      'curl',
      'never',
    ]);

    const all = buildModel({ groupByMuscleFamily: false, dateRange: 'all', recentsOnTop: true });
    expect(all.items.map((item) => item.id)).toEqual([
      'bench',
      'row',
      'curl',
      'unmapped',
      'never',
    ]);
    expect(all.items.find((item) => item.id === 'squat')).toBeUndefined();
  });

  it('renders taxonomy-ordered family sections with zero-count groups and Other last', () => {
    const model = buildModel({ groupByMuscleFamily: true, recentsOnTop: false });

    expect(model.sections.map((section) => `${section.familyName}:${section.count}`)).toEqual([
      'Chest:1',
      'Shoulders:1',
      'Back:1',
      'Arms:1',
      'Core:0',
      'Legs:0',
      'Lower Legs:0',
      'Other:1',
    ]);
  });

  it('keeps grouped mode while search filtering and counts after filtering', () => {
    const stats = aggregateExerciseCatalogStats(rawHistory(), 90, NOW);
    const model = buildExerciseListModel({
      exercises,
      muscleGroups,
      stats,
      preferences: DEFAULT_EXERCISE_LIST_PREFERENCES,
      query: 'press',
      includeDeleted: false,
      showNeverDone: true,
    });

    expect(model.mode).toBe('grouped');
    expect(model.sections.map((section) => `${section.familyName}:${section.count}`)).toEqual([
      'Chest:1',
      'Shoulders:1',
      'Back:0',
      'Arms:0',
      'Core:0',
      'Legs:0',
      'Lower Legs:0',
      'Other:0',
    ]);
  });
});
