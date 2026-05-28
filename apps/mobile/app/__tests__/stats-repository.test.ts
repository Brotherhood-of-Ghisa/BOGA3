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
    { sessionExerciseId: 'se-1', setType: 'warm_up', weightValue: '100', repsValue: '5' },
    { sessionExerciseId: 'se-1', setType: null, weightValue: '100', repsValue: '5' },
    { sessionExerciseId: 'se-1', setType: 'rir_2', weightValue: '110', repsValue: '4' },
    { sessionExerciseId: 'se-2', setType: 'rir_1', weightValue: '20', repsValue: '10' },
    { sessionExerciseId: 'se-2', setType: 'rir_0', weightValue: '20', repsValue: '8' },
    { sessionExerciseId: 'se-3', setType: null, weightValue: '120', repsValue: '3' },
    { sessionExerciseId: 'se-orphan', setType: null, weightValue: '50', repsValue: '5' },
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

const flattenMuscles = (totals: ReturnType<typeof aggregateStats>) =>
  totals.muscleFamilies.flatMap((family) => family.muscles);

describe('aggregateStats', () => {
  it('excludes warm-up sets from totals and counts orphan-exercise sets in total only', () => {
    const totals = aggregateStats(buildAggregationInput());

    expect(totals.sessionCount).toBe(2);
    expect(totals.totalSets).toBe(6);
  });

  it('attributes total weight to muscles using role weights (primary=1, secondary=0.5, stabilizer=0)', () => {
    const totals = aggregateStats(buildAggregationInput());

    const byId = new Map(
      flattenMuscles(totals).map((entry) => [entry.muscleGroupId, entry])
    );

    // chest_sternal (primary): bench sets 100×5 + 110×4 + 120×3 = 1300
    expect(byId.get('chest_sternal')?.totalWeight).toBe(1300);
    // triceps (secondary on bench): 1300 × 0.5 = 650
    expect(byId.get('triceps')?.totalWeight).toBe(650);
    // biceps (primary on curl): 20×10 + 20×8 = 360
    expect(byId.get('biceps')?.totalWeight).toBe(360);
    // calves only stabilizer mapping → 0
    expect(byId.get('calves')?.totalWeight).toBe(0);
  });

  it('counts distinct sessions per muscle (primary + secondary mappings)', () => {
    const totals = aggregateStats(buildAggregationInput());

    const byId = new Map(
      flattenMuscles(totals).map((entry) => [entry.muscleGroupId, entry])
    );

    expect(byId.get('chest_sternal')?.sessionCount).toBe(2);
    expect(byId.get('triceps')?.sessionCount).toBe(2);
    expect(byId.get('biceps')?.sessionCount).toBe(1);
    expect(byId.get('calves')?.sessionCount).toBe(0);
  });

  it('rolls up family sessionCount and totalWeight from member muscles', () => {
    const totals = aggregateStats(buildAggregationInput());

    const familiesByName = new Map(totals.muscleFamilies.map((family) => [family.familyName, family]));

    // Chest family: just chest_sternal so it inherits its totals.
    expect(familiesByName.get('Chest')?.sessionCount).toBe(2);
    expect(familiesByName.get('Chest')?.totalWeight).toBe(1300);

    // Arms family: union of biceps (session-1) + triceps (session-1, session-2) = 2.
    expect(familiesByName.get('Arms')?.sessionCount).toBe(2);
    expect(familiesByName.get('Arms')?.totalWeight).toBe(360 + 650);

    // Legs untrained.
    expect(familiesByName.get('Legs')?.sessionCount).toBe(0);
    expect(familiesByName.get('Legs')?.totalWeight).toBe(0);
  });

  it('always returns the full muscle taxonomy grouped by family', () => {
    const totals = aggregateStats(buildAggregationInput());

    const allIds = flattenMuscles(totals).map((entry) => entry.muscleGroupId);
    expect(allIds).toEqual(expect.arrayContaining(['chest_sternal', 'triceps', 'biceps', 'calves']));
    expect(totals.muscleFamilies.map((family) => family.familyName)).toEqual([
      'Chest',
      'Arms',
      'Legs',
    ]);
  });

  it('handles an empty period with zero totals across the full taxonomy', () => {
    const totals = aggregateStats(
      buildAggregationInput({
        sessions: [],
        sessionExercises: [],
        exerciseSets: [],
      })
    );

    expect(totals.sessionCount).toBe(0);
    expect(totals.totalSets).toBe(0);
    expect(totals.muscleFamilies.every((family) => family.sessionCount === 0 && family.totalWeight === 0)).toBe(true);
    expect(flattenMuscles(totals)).toHaveLength(4);
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

  it('loads a completed-session window for selected-muscle daily effort', async () => {
    const store = buildStore();
    store.loadAggregationInput.mockResolvedValueOnce({
      sessions: [{ id: 'session-1', completedAt: new Date('2026-05-18T08:00:00.000Z') }],
      sessionExercises: [
        {
          id: 'se-1',
          sessionId: 'session-1',
          exerciseDefinitionId: 'ex-bench',
          exerciseName: 'Bench Press',
        },
      ],
      exerciseSets: [
        {
          id: 'set-1',
          sessionExerciseId: 'se-1',
          orderIndex: 0,
          setType: null,
          weightValue: '100',
          repsValue: '5',
        },
      ],
      muscleMappings: [
        { exerciseDefinitionId: 'ex-bench', muscleGroupId: 'chest_sternal', role: 'primary' },
      ],
      muscleGroups: buildMuscleGroupTaxonomy(),
    });

    const repository = createStatsRepository(store);
    const start = new Date('2026-05-01T00:00:00.000Z');
    const end = new Date('2026-06-01T00:00:00.000Z');

    const dailyEffort = await repository.computeSelectedMuscleDailyEffort({
      muscleGroupId: 'chest_sternal',
      start,
      end,
      timeZone: 'UTC',
    });

    expect(store.loadAggregationInput).toHaveBeenCalledWith({ start, end });
    expect(dailyEffort).toHaveLength(1);
    expect(dailyEffort[0]).toMatchObject({
      dateKey: '2026-05-18',
      muscleGroupId: 'chest_sternal',
      sessionCount: 1,
      setCount: 1,
      totalWeight: 500,
    });
    expect(dailyEffort[0].contributions[0]).toMatchObject({
      sessionId: 'session-1',
      sessionExerciseId: 'se-1',
      exerciseDefinitionId: 'ex-bench',
      exerciseName: 'Bench Press',
      setId: 'set-1',
    });
  });
});
