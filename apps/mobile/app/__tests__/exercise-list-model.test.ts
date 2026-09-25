import { aggregateExerciseCatalogStats, type ExerciseCatalogStatsRawHistory } from '@/src/data/exercise-catalog-stats';
import {
  DEFAULT_EXERCISE_LIST_PREFERENCES,
  buildExerciseListModel,
  formatExerciseListStatsSummary,
  type ExerciseListPreferences,
} from '@/src/exercise-catalog/list-model';
import type { IndexedExerciseCatalogExercise } from '@/src/exercise-catalog/search';

const NOW = new Date(2026, 8, 25, 12);
const DAY_MS = 86_400_000;
const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const rawHistory = (): ExerciseCatalogStatsRawHistory => ({
  sessions: [{ id: 'recent', completedAt: daysBefore(2) }, { id: 'old', completedAt: daysBefore(380) }],
  sessionExercises: [
    { id: 'bench-1', sessionId: 'recent', exerciseDefinitionId: 'bench' },
    { id: 'bench-2', sessionId: 'recent', exerciseDefinitionId: 'bench' },
    { id: 'old', sessionId: 'old', exerciseDefinitionId: 'old' },
  ],
  exerciseSets: ['bench-1', 'bench-1', 'bench-2', 'old'].map((sessionExerciseId) => ({
    sessionExerciseId, weightValue: '20', repsValue: '10', setType: 'warm_up',
  })),
});
const muscleGroups = [{ id: 'chest', displayName: 'Chest', familyName: 'Chest', sortOrder: 10 }];
const exercises: IndexedExerciseCatalogExercise[] = [
  { id: 'bench', name: 'Bench Press', deletedAt: null, mappings: [{ id: 'm1', muscleGroupId: 'chest', weight: 1, role: 'primary' }], searchText: 'bench press chest' },
  { id: 'old', name: 'Ancient Press', deletedAt: null, mappings: [{ id: 'm2', muscleGroupId: 'chest', weight: 1, role: 'secondary' }], searchText: 'ancient press' },
  { id: 'never', name: 'Cable Fly', deletedAt: null, mappings: [{ id: 'm3', muscleGroupId: 'chest', weight: 1, role: 'primary' }], searchText: 'cable fly chest' },
  { id: 'unmapped', name: 'Carry', deletedAt: null, mappings: [], searchText: 'carry' },
  { id: 'deleted', name: 'Deleted Fly', deletedAt: NOW, mappings: [], searchText: 'deleted fly' },
];
const buildModel = (preferences: Partial<ExerciseListPreferences> = {}, query = '') => buildExerciseListModel({
  exercises, muscleGroups,
  stats: aggregateExerciseCatalogStats(rawHistory(), 'all', NOW),
  preferences: { ...DEFAULT_EXERCISE_LIST_PREFERENCES, ...preferences },
  query, includeDeleted: false, now: NOW,
});

describe('exercise browser model', () => {
  it('always keeps taxonomy order and the existing fallback mapping, with Other last', () => {
    const model = buildModel();
    expect(model.sections.map((section) => `${section.familyName}:${section.count}`)).toEqual([
      'Chest:3', 'Shoulders:0', 'Back:0', 'Arms:0', 'Core:0', 'Legs:0', 'Lower Legs:0', 'Other:1',
    ]);
    expect(model.sections[0].exercises.map((item) => item.id)).toEqual(['bench', 'old', 'never']);
    const alphabetical = buildModel({ sort: 'name' });
    expect(alphabetical.sections.map((section) => section.familyName)).toEqual(model.sections.map((section) => section.familyName));
    expect(alphabetical.sections[0].exercises.map((item) => item.id)).toEqual(['old', 'bench', 'never']);
  });

  it('breaks equal Favourite scores by latest scoring-window use, then name', () => {
    const stats = aggregateExerciseCatalogStats(rawHistory(), 'all', NOW);
    for (const id of ['bench', 'old', 'never']) stats.recencyScoresById.set(id, {
      exerciseDefinitionId: id, score: 1, completedSetCount: 2,
      lastCompletedAt: daysBefore(id === 'old' ? 10 : 2),
    });
    const model = buildExerciseListModel({ exercises, muscleGroups, stats, preferences: DEFAULT_EXERCISE_LIST_PREFERENCES, query: '', includeDeleted: false, now: NOW });
    expect(model.sections[0].exercises.map((item) => item.id)).toEqual(['bench', 'never', 'old']);
  });

  it('keeps old history visible with never-done off and shows all-time deduplicated sessions', () => {
    const model = buildModel({ showNeverDone: false });
    expect(model.items.map((item) => item.id)).toEqual(['bench', 'old']);
    expect(model.items[0].statsSummary).toBe('Last: 23 Sep · 1 session');
    expect(model.items[1].recency).toBeUndefined();
    expect(model.items[1].statsSummary).toBe('Last: 10 Sep 2025 · 1 session');
    expect(buildModel().items.find((item) => item.id === 'never')?.statsSummary).toBe('Never done');
  });

  it('searches existing name/primary-muscle terms and omits empty families only during search', () => {
    const model = buildModel({}, ' chest ');
    expect(model.isSearching).toBe(true);
    expect(model.sections.map((section) => section.familyName)).toEqual(['Chest']);
    expect(model.items.map((item) => item.id)).toEqual(['bench', 'never']);
    expect(buildModel({}, 'no-match').sections).toEqual([]);
    expect(buildModel({}, '  ').sections).toHaveLength(8);
  });

  it('includes deleted rows only for the management view', () => {
    const model = buildExerciseListModel({ exercises, muscleGroups, stats: aggregateExerciseCatalogStats(rawHistory(), 'all', NOW), preferences: DEFAULT_EXERCISE_LIST_PREFERENCES, query: '', includeDeleted: true });
    expect(model.items.some((item) => item.id === 'deleted')).toBe(true);
  });
});

describe('browser last-performed date', () => {
  const aggregate = { exerciseDefinitionId: 'e', sessionCount: 18, setCount: 40, nearFailureCount: 0, totalVolume: 300, estimatedOneRepMax: 50 };
  afterEach(() => jest.useRealTimers());
  it('uses local dates and refreshes the year at display time across local New Year', () => {
    jest.useFakeTimers();
    const last = new Date(2026, 11, 31, 23, 30);
    jest.setSystemTime(new Date(2026, 11, 31, 23, 59));
    expect(formatExerciseListStatsSummary(aggregate, true, last)).toBe('Last: 31 Dec · 18 sessions');
    jest.setSystemTime(new Date(2027, 0, 1, 0, 1));
    expect(formatExerciseListStatsSummary(aggregate, true, last)).toBe('Last: 31 Dec 2026 · 18 sessions');
  });
  it('never invents a date for an unused exercise', () => {
    expect(formatExerciseListStatsSummary(undefined, false, null, NOW)).toBe('Never done');
  });
});
