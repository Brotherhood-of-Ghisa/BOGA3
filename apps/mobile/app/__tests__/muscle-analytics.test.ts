import {
  aggregateSelectedMuscleDailyEffort,
  aggregateSelectedMuscleDailyEffortMetrics,
  getMuscleContributionRoleWeight,
  type MuscleAnalyticsInput,
} from '@/src/data/muscle-analytics';

describe('per-side load semantics', () => {
  const contributionFor = (loadInputMode: 'total_load' | 'per_side_load', weightValue: string) =>
    aggregateSelectedMuscleDailyEffort(
      buildAnalyticsInput({
        sessions: [{ id: 'session', completedAt: new Date('2026-07-22T12:00:00Z') }],
        exerciseDefinitions: [{ id: 'bench', loadInputMode }],
        sessionExercises: [
          { id: 'session-exercise', sessionId: 'session', exerciseDefinitionId: 'bench' },
        ],
        exerciseSets: [
          {
            id: 'set',
            sessionExerciseId: 'session-exercise',
            setType: null,
            weightValue,
            repsValue: '1',
          },
        ],
        muscleMappings: [
          {
            exerciseDefinitionId: 'bench',
            muscleGroupId: 'chest_sternal',
            role: 'primary',
          },
        ],
      }),
      { muscleGroupIds: ['chest_sternal'], timeZone: 'UTC' }
    )[0]?.totalWeight;

  it('halves shared total load and preserves already-per-side load', () => {
    expect(contributionFor('total_load', '45')).toBe(22.5);
    expect(contributionFor('per_side_load', '22')).toBe(22);
  });

  it('combines barbell and dumbbell chest work on the same per-side basis', () => {
    expect(contributionFor('total_load', '45') + contributionFor('per_side_load', '22')).toBe(
      44.5
    );
  });

  it('treats a shared two-arm pullover load as total load', () => {
    expect(contributionFor('total_load', '22')).toBe(11);
  });

  it('treats a one-arm row entry as the per-side load with both sides implied', () => {
    expect(contributionFor('per_side_load', '22')).toBe(22);
  });

  it('uses the role factor after per-side normalization, ignoring legacy mapping weight', () => {
    const input = buildAnalyticsInput({
      exerciseDefinitions: [{ id: 'ex-press', loadInputMode: 'total_load' }],
      muscleMappings: [
        {
          exerciseDefinitionId: 'ex-press',
          muscleGroupId: 'chest_sternal',
          role: 'secondary',
          weight: 0.25,
        },
      ],
    });
    const entries = aggregateSelectedMuscleDailyEffort(input, {
      muscleGroupIds: ['chest_sternal'],
      timeZone: 'Europe/London',
    });
    expect(entries[0]?.contributions[0]?.weightedVolume).toBe(250);
    expect(entries[0]?.contributions[0]?.roleWeight).toBe(0.5);
  });
});

const buildAnalyticsInput = (
  overrides: Partial<MuscleAnalyticsInput> = {}
): MuscleAnalyticsInput => ({
  exerciseDefinitions: [
    { id: 'ex-press', loadInputMode: 'per_side_load' },
    { id: 'ex-curl', loadInputMode: 'per_side_load' },
  ],
  sessions: [
    { id: 'session-sunday', completedAt: new Date('2026-03-29T22:30:00.000Z') },
    { id: 'session-monday-a', completedAt: new Date('2026-03-29T23:30:00.000Z') },
    { id: 'session-monday-b', completedAt: new Date('2026-03-30T11:00:00.000Z') },
    { id: 'session-month-edge', completedAt: new Date('2026-04-30T23:30:00.000Z') },
  ],
  sessionExercises: [
    {
      id: 'se-sunday',
      sessionId: 'session-sunday',
      exerciseDefinitionId: 'ex-press',
      exerciseName: 'Press',
    },
    {
      id: 'se-monday-a',
      sessionId: 'session-monday-a',
      exerciseDefinitionId: 'ex-press',
      exerciseName: 'Press',
    },
    {
      id: 'se-monday-b',
      sessionId: 'session-monday-b',
      exerciseDefinitionId: 'ex-curl',
      exerciseName: 'Curl',
    },
    {
      id: 'se-month-edge',
      sessionId: 'session-month-edge',
      exerciseDefinitionId: 'ex-press',
      exerciseName: 'Press',
    },
  ],
  exerciseSets: [
    {
      id: 'set-sunday-warmup',
      sessionExerciseId: 'se-sunday',
      orderIndex: 0,
      setType: 'warm_up',
      weightValue: '100',
      repsValue: '10',
    },
    {
      id: 'set-sunday-work',
      sessionExerciseId: 'se-sunday',
      orderIndex: 1,
      setType: null,
      weightValue: '100',
      repsValue: '5',
    },
    {
      id: 'set-monday-a-valid',
      sessionExerciseId: 'se-monday-a',
      orderIndex: 0,
      setType: 'rir_1',
      weightValue: '120',
      repsValue: '5',
    },
    {
      id: 'set-monday-a-invalid',
      sessionExerciseId: 'se-monday-a',
      orderIndex: 1,
      setType: null,
      weightValue: '120kg',
      repsValue: '5',
    },
    {
      id: 'set-monday-b-valid',
      sessionExerciseId: 'se-monday-b',
      orderIndex: 0,
      setType: null,
      weightValue: '20',
      repsValue: '10',
    },
    {
      id: 'set-month-edge',
      sessionExerciseId: 'se-month-edge',
      orderIndex: 0,
      setType: null,
      weightValue: '80',
      repsValue: '3',
    },
  ],
  muscleMappings: [
    { exerciseDefinitionId: 'ex-press', muscleGroupId: 'chest_sternal', role: 'primary' },
    { exerciseDefinitionId: 'ex-press', muscleGroupId: 'triceps', role: 'secondary' },
    { exerciseDefinitionId: 'ex-press', muscleGroupId: 'core', role: 'stabilizer' },
    { exerciseDefinitionId: 'ex-curl', muscleGroupId: 'biceps', role: 'primary' },
  ],
  muscleGroups: [
    { id: 'chest_sternal', displayName: 'Chest (sternal)', familyName: 'Chest', sortOrder: 10 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 20 },
    { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 30 },
    { id: 'core', displayName: 'Core', familyName: 'Core', sortOrder: 40 },
  ],
  ...overrides,
});

describe('getMuscleContributionRoleWeight', () => {
  it('preserves current Stats role contribution weights', () => {
    expect(getMuscleContributionRoleWeight('primary')).toBe(1);
    expect(getMuscleContributionRoleWeight('secondary')).toBe(0.5);
    expect(getMuscleContributionRoleWeight('stabilizer')).toBe(0);
    expect(getMuscleContributionRoleWeight(null)).toBe(0);
  });
});

describe('aggregateSelectedMuscleDailyEffort', () => {
  it('groups completed sessions by deterministic local dates across Monday/Sunday and month boundaries', () => {
    const entries = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), {
      muscleGroupIds: ['chest_sternal'],
      timeZone: 'Europe/London',
    });

    expect(entries.map((entry) => entry.dateKey)).toEqual([
      '2026-03-29',
      '2026-03-30',
      '2026-05-01',
    ]);
  });

  it('preserves invalid-set zero volume and aggregates multiple sessions on one local day', () => {
    const entries = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), {
      muscleGroupIds: ['chest_sternal'],
      timeZone: 'Europe/London',
    });

    const monday = entries.find((entry) => entry.dateKey === '2026-03-30');

    expect(monday?.sessionCount).toBe(1);
    expect(monday?.setCount).toBe(2);
    expect(monday?.totalWeight).toBe(600);
    expect(monday?.contributions.map((contribution) => contribution.setId)).toEqual([
      'set-monday-a-valid',
      'set-monday-a-invalid',
    ]);
    expect(
      monday?.contributions.find((contribution) => contribution.setId === 'set-monday-a-invalid')
        ?.setVolume
    ).toBe(0);
  });

  it('rolls multiple selected-muscle sessions on the same local day into one daily entry', () => {
    const input = buildAnalyticsInput({
      sessionExercises: [
        ...buildAnalyticsInput().sessionExercises,
        {
          id: 'se-monday-c',
          sessionId: 'session-monday-b',
          exerciseDefinitionId: 'ex-press',
          exerciseName: 'Press',
        },
      ],
      exerciseSets: [
        ...buildAnalyticsInput().exerciseSets,
        {
          id: 'set-monday-c-valid',
          sessionExerciseId: 'se-monday-c',
          orderIndex: 0,
          setType: null,
          weightValue: '50',
          repsValue: '4',
        },
      ],
    });

    const entries = aggregateSelectedMuscleDailyEffort(input, {
      muscleGroupIds: ['chest_sternal'],
      timeZone: 'Europe/London',
    });

    const monday = entries.find((entry) => entry.dateKey === '2026-03-30');

    expect(monday?.sessionCount).toBe(2);
    expect(monday?.setCount).toBe(3);
    expect(monday?.totalWeight).toBe(800);
  });

  it('uses the shared contribution math for secondary and multi-muscle exercises', () => {
    const entries = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), {
      muscleGroupIds: ['triceps'],
      timeZone: 'Europe/London',
    });

    const sunday = entries.find((entry) => entry.dateKey === '2026-03-29');
    const monday = entries.find((entry) => entry.dateKey === '2026-03-30');

    expect(sunday?.totalWeight).toBe(750);
    expect(monday?.totalWeight).toBe(300);
    expect(monday?.contributions[0]).toMatchObject({
      muscleGroupId: 'triceps',
      role: 'secondary',
      roleWeight: 0.5,
      setVolume: 600,
      weightedVolume: 300,
      exerciseDefinitionId: 'ex-press',
      exerciseName: 'Press',
    });
  });
});

describe('aggregateSelectedMuscleDailyEffortMetrics', () => {
  const options = { muscleGroupIds: ['chest_sternal'], timeZone: 'Europe/London' };

  it('emits one metric row per training day, aligned with the daily effort', () => {
    const daily = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), options);
    const metrics = aggregateSelectedMuscleDailyEffortMetrics(daily);

    expect(metrics.map((m) => m.dateKey)).toEqual(daily.map((d) => d.dateKey));
  });

  it('derives totalVolume from the same weighted contributions as totalWeight', () => {
    const daily = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), options);
    const metrics = aggregateSelectedMuscleDailyEffortMetrics(daily);

    const monday = metrics.find((m) => m.dateKey === '2026-03-30');
    expect(monday?.totalVolume).toBe(600);
    expect(monday?.highestWeight).not.toBeNull();
  });
});
