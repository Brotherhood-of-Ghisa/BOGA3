import {
  aggregateSelectedMuscleDailyEffort,
  getMuscleContributionRoleWeight,
  type MuscleAnalyticsInput,
} from '@/src/data/muscle-analytics';

const buildAnalyticsInput = (
  overrides: Partial<MuscleAnalyticsInput> = {}
): MuscleAnalyticsInput => ({
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
      muscleGroupId: 'chest_sternal',
      timeZone: 'Europe/London',
    });

    expect(entries.map((entry) => entry.dateKey)).toEqual([
      '2026-03-29',
      '2026-03-30',
      '2026-05-01',
    ]);
  });

  it('excludes warm-ups, preserves invalid-set zero volume, and aggregates multiple sessions on one local day', () => {
    const entries = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), {
      muscleGroupId: 'chest_sternal',
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
      muscleGroupId: 'chest_sternal',
      timeZone: 'Europe/London',
    });

    const monday = entries.find((entry) => entry.dateKey === '2026-03-30');

    expect(monday?.sessionCount).toBe(2);
    expect(monday?.setCount).toBe(3);
    expect(monday?.totalWeight).toBe(800);
  });

  it('uses the shared contribution math for secondary and multi-muscle exercises', () => {
    const entries = aggregateSelectedMuscleDailyEffort(buildAnalyticsInput(), {
      muscleGroupId: 'triceps',
      timeZone: 'Europe/London',
    });

    const sunday = entries.find((entry) => entry.dateKey === '2026-03-29');
    const monday = entries.find((entry) => entry.dateKey === '2026-03-30');

    expect(sunday?.totalWeight).toBe(250);
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
