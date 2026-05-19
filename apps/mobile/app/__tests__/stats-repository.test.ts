import {
  aggregateStats,
  computePeriodBounds,
  createStatsRepository,
  type StatsAggregationInput,
  type StatsStore,
} from '@/src/data/stats';

const buildMuscleGroupTaxonomy = (): StatsAggregationInput['muscleGroups'] => [
  { id: 'chest_sternal', displayName: 'Chest (sternal)', familyName: 'Chest', sortOrder: 10 },
  { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 20 },
  { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 30 },
  { id: 'calves', displayName: 'Calves', familyName: 'Legs', sortOrder: 40 },
];

const buildAggregationInput = (
  overrides: Partial<StatsAggregationInput> = {}
): StatsAggregationInput => ({
  sessions: [
    { id: 'session-1', completedAt: new Date('2026-05-12T10:00:00.000Z') },
    { id: 'session-2', completedAt: new Date('2026-05-15T10:00:00.000Z') },
  ],
  sessionExercises: [
    { id: 'se-1', sessionId: 'session-1', exerciseDefinitionId: 'ex-bench' },
    { id: 'se-2', sessionId: 'session-1', exerciseDefinitionId: 'ex-curl' },
    { id: 'se-3', sessionId: 'session-2', exerciseDefinitionId: 'ex-bench' },
    { id: 'se-orphan', sessionId: 'session-2', exerciseDefinitionId: null },
  ],
  exerciseSets: [
    { sessionExerciseId: 'se-1', setType: 'warm_up' },
    { sessionExerciseId: 'se-1', setType: null },
    { sessionExerciseId: 'se-1', setType: 'rir_2' },
    { sessionExerciseId: 'se-2', setType: 'rir_1' },
    { sessionExerciseId: 'se-2', setType: 'rir_0' },
    { sessionExerciseId: 'se-3', setType: null },
    { sessionExerciseId: 'se-orphan', setType: null },
  ],
  muscleMappings: [
    { exerciseDefinitionId: 'ex-bench', muscleGroupId: 'chest_sternal', role: 'primary' },
    { exerciseDefinitionId: 'ex-bench', muscleGroupId: 'triceps', role: 'secondary' },
    { exerciseDefinitionId: 'ex-curl', muscleGroupId: 'biceps', role: 'primary' },
    { exerciseDefinitionId: 'ex-curl', muscleGroupId: 'calves', role: 'stabilizer' },
  ],
  muscleGroups: buildMuscleGroupTaxonomy(),
  ...overrides,
});

describe('aggregateStats', () => {
  it('excludes warm-up sets from totals and counts orphan-exercise sets in total only', () => {
    const totals = aggregateStats(buildAggregationInput());

    expect(totals.sessionCount).toBe(2);
    expect(totals.totalSets).toBe(6);
  });

  it('weights muscle groups by role (primary=1, secondary=0.5, stabilizer=0, null=0)', () => {
    const totals = aggregateStats(buildAggregationInput());

    const scoreById = new Map(
      totals.setsByMuscleGroup.map((entry) => [entry.muscleGroupId, entry.score])
    );

    expect(scoreById.get('chest_sternal')).toBe(3);
    expect(scoreById.get('triceps')).toBe(1.5);
    expect(scoreById.get('biceps')).toBe(2);
    expect(scoreById.get('calves')).toBe(0);
  });

  it('always returns the full muscle taxonomy, including untrained groups', () => {
    const totals = aggregateStats(buildAggregationInput());

    const ids = totals.setsByMuscleGroup.map((entry) => entry.muscleGroupId);
    expect(ids).toContain('calves');
    expect(totals.setsByMuscleGroup).toHaveLength(4);
  });

  it('sorts muscle groups by score desc, then taxonomy sortOrder, then displayName', () => {
    const totals = aggregateStats(buildAggregationInput());

    expect(totals.setsByMuscleGroup.map((entry) => entry.muscleGroupId)).toEqual([
      'chest_sternal',
      'biceps',
      'triceps',
      'calves',
    ]);
  });

  it('handles an empty period with zero scores across the full taxonomy', () => {
    const totals = aggregateStats(
      buildAggregationInput({
        sessions: [],
        sessionExercises: [],
        exerciseSets: [],
      })
    );

    expect(totals.sessionCount).toBe(0);
    expect(totals.totalSets).toBe(0);
    expect(totals.setsByMuscleGroup.every((entry) => entry.score === 0)).toBe(true);
    expect(totals.setsByMuscleGroup).toHaveLength(4);
  });
});

describe('computePeriodBounds', () => {
  it('produces a window of the requested length ending at now', () => {
    const now = new Date('2026-05-19T15:00:00.000Z');
    const sevenDay = computePeriodBounds(7, now);

    expect(sevenDay.days).toBe(7);
    expect(sevenDay.end.toISOString()).toBe('2026-05-19T15:00:00.000Z');
    expect(sevenDay.start.toISOString()).toBe('2026-05-12T15:00:00.000Z');
  });
});

describe('createStatsRepository.computeSummary', () => {
  const buildStore = (): jest.Mocked<StatsStore> => ({
    loadAggregationInput: jest.fn(),
    loadMuscleGroupTaxonomy: jest.fn(),
  });

  it('loads current and previous adjacent windows for the chosen period', async () => {
    const store = buildStore();
    const taxonomy = buildMuscleGroupTaxonomy();
    store.loadAggregationInput
      .mockResolvedValueOnce({
        sessions: [{ id: 's-curr', completedAt: new Date('2026-05-18T08:00:00.000Z') }],
        sessionExercises: [],
        exerciseSets: [],
        muscleMappings: [],
        muscleGroups: taxonomy,
      })
      .mockResolvedValueOnce({
        sessions: [
          { id: 's-prev-1', completedAt: new Date('2026-05-08T08:00:00.000Z') },
          { id: 's-prev-2', completedAt: new Date('2026-05-09T08:00:00.000Z') },
        ],
        sessionExercises: [],
        exerciseSets: [],
        muscleMappings: [],
        muscleGroups: taxonomy,
      });

    const repository = createStatsRepository(store);

    const summary = await repository.computeSummary({
      periodDays: 7,
      now: new Date('2026-05-19T15:00:00.000Z'),
    });

    expect(store.loadAggregationInput).toHaveBeenCalledTimes(2);
    expect(store.loadAggregationInput).toHaveBeenNthCalledWith(1, {
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: new Date('2026-05-19T15:00:00.000Z'),
    });
    expect(store.loadAggregationInput).toHaveBeenNthCalledWith(2, {
      start: new Date('2026-05-05T15:00:00.000Z'),
      end: new Date('2026-05-12T15:00:00.000Z'),
    });

    expect(summary.current.totals.sessionCount).toBe(1);
    expect(summary.previous.totals.sessionCount).toBe(2);
    expect(summary.current.period.days).toBe(7);
  });
});
