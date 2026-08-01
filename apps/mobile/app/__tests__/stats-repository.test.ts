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
  exerciseDefinitions: [
    { id: 'ex-bench', loadInputMode: 'per_side_load' },
    { id: 'ex-curl', loadInputMode: 'per_side_load' },
  ],
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
  it('counts all valid performed sets and the confirmed RIR 0-2 working subset', () => {
    const totals = aggregateStats(buildAggregationInput());

    expect(totals.sessionCount).toBe(2);
    expect(totals.setCount).toBe(7);
    expect(totals.workingSetCount).toBe(3);
  });

  it('excludes valid but unconfirmed sets from set and muscle totals', () => {
    const input = buildAggregationInput();
    input.exerciseSets.push({
      sessionExerciseId: 'se-1',
      setType: 'rir_0',
      weightValue: '500',
      repsValue: '10',
      performanceStatus: 'unperformed',
    });

    const totals = aggregateStats(input);
    const byId = new Map(flattenMuscles(totals).map((entry) => [entry.muscleGroupId, entry]));
    expect(totals.setCount).toBe(7);
    expect(totals.workingSetCount).toBe(3);
    expect(byId.get('chest_sternal')?.totalVolume).toBe(1800);
    expect(byId.get('chest_sternal')?.setCount).toBe(4);
    expect(byId.get('chest_sternal')?.nearFailureCount).toBe(1);
  });

  it('attributes per-side volume and set counts using primary, secondary, and stabilizer roles', () => {
    const totals = aggregateStats(buildAggregationInput());

    const byId = new Map(
      flattenMuscles(totals).map((entry) => [entry.muscleGroupId, entry])
    );

    // chest_sternal (primary): bench sets 100×5 + 100x5 + 110×4 + 120×3 = 1800
    expect(byId.get('chest_sternal')?.totalVolume).toBe(1800);
    expect(byId.get('chest_sternal')?.setCount).toBe(4);
    expect(byId.get('chest_sternal')?.nearFailureCount).toBe(1);
    // triceps (secondary on bench): 1800 × 0.5 = 900
    expect(byId.get('triceps')?.totalVolume).toBe(900);
    expect(byId.get('triceps')?.setCount).toBe(4);
    expect(byId.get('triceps')?.nearFailureCount).toBe(1);
    // biceps (primary on curl): 20×10 + 20×8 = 360
    expect(byId.get('biceps')?.totalVolume).toBe(360);
    expect(byId.get('biceps')?.setCount).toBe(2);
    expect(byId.get('biceps')?.nearFailureCount).toBe(2);
    // calves only stabilizer mapping → 0
    expect(byId.get('calves')?.totalVolume).toBe(0);
    expect(byId.get('calves')?.setCount).toBe(0);
    expect(byId.get('calves')?.nearFailureCount).toBe(0);
  });

  it('rolls up family set counts by physical-set identity while summing muscle volume', () => {
    const totals = aggregateStats(buildAggregationInput());

    const familiesByName = new Map(totals.muscleFamilies.map((family) => [family.familyName, family]));

    // Chest family: just chest_sternal so it inherits its totals.
    expect(familiesByName.get('Chest')?.setCount).toBe(4);
    expect(familiesByName.get('Chest')?.nearFailureCount).toBe(1);
    expect(familiesByName.get('Chest')?.totalVolume).toBe(1800);

    // Arms family: six distinct physical sets across biceps and triceps.
    expect(familiesByName.get('Arms')?.setCount).toBe(6);
    expect(familiesByName.get('Arms')?.nearFailureCount).toBe(3);
    expect(familiesByName.get('Arms')?.totalVolume).toBe(360 + 900);

    // Legs untrained.
    expect(familiesByName.get('Legs')?.setCount).toBe(0);
    expect(familiesByName.get('Legs')?.nearFailureCount).toBe(0);
    expect(familiesByName.get('Legs')?.totalVolume).toBe(0);
  });

  it('deduplicates one physical set mapped to multiple muscles in the same family', () => {
    const input = buildAggregationInput();
    input.muscleMappings.push({
      exerciseDefinitionId: 'ex-bench',
      muscleGroupId: 'biceps',
      role: 'primary',
    });

    const totals = aggregateStats(input);
    const arms = totals.muscleFamilies.find((family) => family.familyName === 'Arms');

    // The four bench sets contribute to both biceps and triceps, but count once
    // at family level; the two curl sets remain distinct.
    expect(arms?.setCount).toBe(6);
    expect(arms?.nearFailureCount).toBe(3);
    expect(arms?.totalVolume).toBe(360 + 1800 + 900);
  });

  it('halves total-load volume before role weighting and ignores legacy mapping weight', () => {
    const input = buildAggregationInput({
      exerciseDefinitions: [
        { id: 'ex-bench', loadInputMode: 'total_load' },
        { id: 'ex-curl', loadInputMode: 'per_side_load' },
      ],
    });
    input.muscleMappings = input.muscleMappings.map((mapping) => ({
      ...mapping,
      weight: 99,
    }));

    const totals = aggregateStats(input);
    const byId = new Map(flattenMuscles(totals).map((entry) => [entry.muscleGroupId, entry]));

    expect(byId.get('chest_sternal')?.totalVolume).toBe(900);
    expect(byId.get('triceps')?.totalVolume).toBe(450);
    expect(byId.get('biceps')?.totalVolume).toBe(360);
  });

  it('counts valid zero-load, warm-up, and unknown-quality sets but only RIR 0-2 as near failure', () => {
    const input = buildAggregationInput({
      sessions: [{ id: 'session-1', completedAt: new Date('2026-05-12T10:00:00.000Z') }],
      sessionExercises: [
        { id: 'se-1', sessionId: 'session-1', exerciseDefinitionId: 'ex-bench' },
      ],
      exerciseSets: [
        { id: 'zero', sessionExerciseId: 'se-1', setType: 'rir_0', weightValue: '0', repsValue: '5' },
        { id: 'warm', sessionExerciseId: 'se-1', setType: 'warm_up', weightValue: '20', repsValue: '5' },
        { id: 'unknown', sessionExerciseId: 'se-1', setType: 'legacy', weightValue: '20', repsValue: '5' },
        { id: 'blank', sessionExerciseId: 'se-1', setType: 'rir_2', weightValue: '', repsValue: '5' },
        { id: 'bad-weight', sessionExerciseId: 'se-1', setType: 'rir_1', weightValue: '-1', repsValue: '5' },
        { id: 'bad-reps', sessionExerciseId: 'se-1', setType: 'rir_2', weightValue: '20', repsValue: '1.5' },
      ],
    });

    const totals = aggregateStats(input);
    const chest = flattenMuscles(totals).find((entry) => entry.muscleGroupId === 'chest_sternal');
    expect(totals.setCount).toBe(3);
    expect(totals.workingSetCount).toBe(1);
    expect(chest).toMatchObject({ setCount: 3, nearFailureCount: 1, totalVolume: 200 });
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
    expect(totals.setCount).toBe(0);
    expect(totals.workingSetCount).toBe(0);
    expect(
      totals.muscleFamilies.every(
        (family) =>
          family.setCount === 0 &&
          family.nearFailureCount === 0 &&
          family.totalVolume === 0
      )
    ).toBe(true);
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
      exerciseDefinitions: [{ id: 'ex-bench', loadInputMode: 'per_side_load' }],
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
      muscleGroupIds: ['chest_sternal'],
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
