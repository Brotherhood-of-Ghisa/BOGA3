import {
  createCompletedSessionInsightsRepository,
  buildPersonalRecordShareMessage,
  deriveExercisePersonalRecord,
  deriveSessionPersonalRecords,
  sharePersonalRecord,
  summarizeCurrentSessionMuscleLoad,
  type CurrentSessionMuscleSummaryInput,
  type PersonalRecordSessionInput,
  type SessionInsightExerciseInput,
  type SessionInsightsStore,
} from '@/src/session-insights';
import { estimateOneRepMax } from '@/src/exercise-calculations';

const AT = new Date('2026-09-12T10:00:00.000Z');

const insightExercise = (
  overrides: Partial<SessionInsightExerciseInput> & {
    id: string;
    exerciseDefinitionId: string | null;
  }
): SessionInsightExerciseInput => ({
  orderIndex: 0,
  exerciseName: overrides.exerciseDefinitionId ?? 'Unlinked exercise',
  sets: [],
  ...overrides,
});

const insightSet = (
  id: string,
  overrides: Partial<SessionInsightExerciseInput['sets'][number]> = {}
): SessionInsightExerciseInput['sets'][number] => ({
  id,
  orderIndex: 0,
  weightValue: '100',
  repsValue: '5',
  setType: null,
  performanceStatus: null,
  ...overrides,
});

const muscleInput = (
  overrides: Partial<CurrentSessionMuscleSummaryInput> = {}
): CurrentSessionMuscleSummaryInput => ({
  sessionId: 'target',
  sessionAt: AT,
  exercises: [],
  exerciseDefinitions: [],
  muscleMappings: [],
  muscleGroups: [
    { id: 'chest', displayName: 'Chest', familyName: 'Torso', sortOrder: 20 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 30 },
    { id: 'biceps', displayName: 'Biceps', familyName: 'Arms', sortOrder: 10 },
  ],
  ...overrides,
});

const completedSession = (
  overrides: Partial<PersonalRecordSessionInput> & { sessionId: string }
): PersonalRecordSessionInput => ({
  status: 'completed',
  completedAt: AT,
  deletedAt: null,
  exercises: [],
  ...overrides,
});

describe('personal record sharing', () => {
  const personalRecord = {
    exerciseDefinitionId: 'bench',
    exerciseName: 'Bench Press',
    sessionExerciseId: 'bench-row',
    sessionExerciseOrderIndex: 0,
    setId: 'bench-set',
    setOrderIndex: 0,
    weight: 102.5,
    reps: 5,
    estimatedOneRepMax: 119.58,
    historicalBestEstimatedOneRepMax: 115,
  };

  it('builds a stable text-only payload from the visible PR facts', () => {
    expect(buildPersonalRecordShareMessage(personalRecord)).toBe(
      'New PR: Bench Press — 102.5 kg × 5 reps · estimated 1RM 120 kg.'
    );
  });

  it('launches the injected platform share boundary and treats dismissal as a no-op', async () => {
    const share = jest.fn().mockResolvedValue({ action: 'dismissedAction' });

    await expect(sharePersonalRecord(personalRecord, share)).resolves.toBeUndefined();
    expect(share).toHaveBeenCalledWith({
      message: 'New PR: Bench Press — 102.5 kg × 5 reps · estimated 1RM 120 kg.',
    });
  });
});

describe('summarizeCurrentSessionMuscleLoad', () => {
  it('keeps the summary empty until a valid performed set is confirmed', () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exercises: [
          insightExercise({
            id: 'bench-row',
            exerciseDefinitionId: 'bench',
            sets: [
              insightSet('unconfirmed', { performanceStatus: 'unperformed' }),
              insightSet('invalid', { repsValue: '0' }),
            ],
          }),
        ],
      })
    );

    expect(summary).toEqual({
      state: 'empty',
      performedSetCount: 0,
      workingSetCount: 0,
      mappedSetCount: 0,
      unmappedSetCount: 0,
      contributingMuscleCount: 0,
      muscles: [],
    });
  });

  it('reuses per-side and role-weighted analytics while counting each physical set once', () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { id: 'barbell-bench', loadInputMode: 'total_load' },
          { id: 'curl', loadInputMode: 'per_side_load' },
        ],
        exercises: [
          insightExercise({
            id: 'bench-row',
            exerciseDefinitionId: 'barbell-bench',
            exerciseName: 'Barbell Bench Press',
            orderIndex: 1,
            sets: [
              insightSet('bench-warm-up', {
                orderIndex: 0,
                weightValue: '100',
                repsValue: '10',
                setType: 'warm_up',
              }),
              insightSet('bench-working', {
                orderIndex: 1,
                weightValue: '100',
                repsValue: '5',
                setType: 'rir_1',
              }),
            ],
          }),
          insightExercise({
            id: 'curl-row',
            exerciseDefinitionId: 'curl',
            exerciseName: 'Curl',
            orderIndex: 2,
            sets: [
              insightSet('curl-working', {
                weightValue: '25',
                repsValue: '10',
                setType: 'rir_0',
              }),
            ],
          }),
        ],
        muscleMappings: [
          { exerciseDefinitionId: 'barbell-bench', muscleGroupId: 'chest', role: 'primary' },
          {
            exerciseDefinitionId: 'barbell-bench',
            muscleGroupId: 'triceps',
            role: 'secondary',
          },
          { exerciseDefinitionId: 'barbell-bench', muscleGroupId: 'biceps', role: 'stabilizer' },
          { exerciseDefinitionId: 'curl', muscleGroupId: 'biceps', role: 'primary' },
        ],
      })
    );

    expect(summary).toMatchObject({
      state: 'mapped',
      performedSetCount: 3,
      workingSetCount: 2,
      mappedSetCount: 3,
      unmappedSetCount: 0,
      contributingMuscleCount: 3,
    });
    expect(summary.muscles).toEqual([
      expect.objectContaining({ id: 'chest', weightedVolume: 750, relativeVolume: 1 }),
      expect.objectContaining({ id: 'triceps', weightedVolume: 375, relativeVolume: 0.5 }),
      expect.objectContaining({
        id: 'biceps',
        weightedVolume: 250,
        relativeVolume: 1 / 3,
      }),
    ]);
  });

  it('reports partially mapped and fully unmapped work without zero-valued muscles', () => {
    const partial = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [
          { id: 'mapped', loadInputMode: 'per_side_load' },
          { id: 'unmapped', loadInputMode: 'per_side_load' },
          { id: 'stabilizer-only', loadInputMode: 'per_side_load' },
        ],
        exercises: [
          insightExercise({
            id: 'mapped-row',
            exerciseDefinitionId: 'mapped',
            sets: [insightSet('mapped-set')],
          }),
          insightExercise({
            id: 'unmapped-row',
            exerciseDefinitionId: 'unmapped',
            orderIndex: 1,
            sets: [insightSet('unmapped-set')],
          }),
          insightExercise({
            id: 'stabilizer-row',
            exerciseDefinitionId: 'stabilizer-only',
            orderIndex: 2,
            sets: [insightSet('stabilizer-set')],
          }),
        ],
        muscleMappings: [
          { exerciseDefinitionId: 'mapped', muscleGroupId: 'chest', role: 'primary' },
          { exerciseDefinitionId: 'stabilizer-only', muscleGroupId: 'biceps', role: 'stabilizer' },
        ],
      })
    );

    expect(partial).toMatchObject({
      state: 'mapped',
      performedSetCount: 3,
      mappedSetCount: 1,
      unmappedSetCount: 2,
      contributingMuscleCount: 1,
    });
    expect(partial.muscles.map((muscle) => muscle.id)).toEqual(['chest']);

    const unmapped = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exercises: [
          insightExercise({
            id: 'unmapped-row',
            exerciseDefinitionId: 'unmapped',
            sets: [insightSet('unmapped-set')],
          }),
        ],
      })
    );
    expect(unmapped).toMatchObject({
      state: 'unmapped',
      performedSetCount: 1,
      mappedSetCount: 0,
      unmappedSetCount: 1,
      muscles: [],
    });
  });

  it('uses taxonomy order as the stable tie-breaker and excludes tombstones', () => {
    const summary = summarizeCurrentSessionMuscleLoad(
      muscleInput({
        exerciseDefinitions: [{ id: 'press', loadInputMode: 'per_side_load' }],
        exercises: [
          insightExercise({
            id: 'press-row',
            exerciseDefinitionId: 'press',
            sets: [
              insightSet('kept'),
              insightSet('deleted', { deletedAt: AT }),
            ],
          }),
        ],
        muscleMappings: [
          { exerciseDefinitionId: 'press', muscleGroupId: 'chest', role: 'primary' },
          { exerciseDefinitionId: 'press', muscleGroupId: 'biceps', role: 'primary' },
        ],
      })
    );

    expect(summary.performedSetCount).toBe(1);
    expect(summary.muscles.map((muscle) => muscle.id)).toEqual(['biceps', 'chest']);
    expect(summary.muscles.every((muscle) => muscle.relativeVolume === 1)).toBe(true);
  });

  it('rejects an invalid session timestamp instead of consulting the wall clock', () => {
    expect(() =>
      summarizeCurrentSessionMuscleLoad(muscleInput({ sessionAt: new Date('invalid') }))
    ).toThrow('sessionAt must be a valid Date');
  });
});

describe('deriveExercisePersonalRecord', () => {
  const exercise = insightExercise({
    id: 'bench-row',
    exerciseDefinitionId: 'bench',
    exerciseName: 'Bench Press',
    sets: [insightSet('set-b', { weightValue: '110', repsValue: '5' })],
  });

  it('returns the best entered set only for a strict improvement over an existing baseline', () => {
    const historicalBest = estimateOneRepMax(100, 5) as number;
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: 'bench',
      exercises: [exercise],
      historicalBestEstimatedOneRepMax: historicalBest,
    });

    expect(record).toEqual(
      expect.objectContaining({
        exerciseDefinitionId: 'bench',
        exerciseName: 'Bench Press',
        sessionExerciseId: 'bench-row',
        setId: 'set-b',
        weight: 110,
        reps: 5,
        historicalBestEstimatedOneRepMax: historicalBest,
      })
    );
    expect(record?.estimatedOneRepMax).toBeCloseTo(estimateOneRepMax(110, 5) as number);
  });

  it.each([
    ['equal', estimateOneRepMax(110, 5) as number],
    ['above current', (estimateOneRepMax(110, 5) as number) + 1],
    ['no baseline', null],
  ])('does not label %s as a PR', (_label, historicalBestEstimatedOneRepMax) => {
    expect(
      deriveExercisePersonalRecord({
        exerciseDefinitionId: 'bench',
        exercises: [exercise],
        historicalBestEstimatedOneRepMax,
      })
    ).toBeNull();
  });

  it('ignores unconfirmed work and resolves ties by set order then stable set id', () => {
    const tiedExercise = insightExercise({
      ...exercise,
      sets: [
        insightSet('unconfirmed', {
          orderIndex: 0,
          weightValue: '500',
          repsValue: '10',
          performanceStatus: 'unperformed',
        }),
        insightSet('set-z', { orderIndex: 2, weightValue: '120', repsValue: '5' }),
        insightSet('set-b', { orderIndex: 1, weightValue: '120', repsValue: '5' }),
        insightSet('set-a', { orderIndex: 1, weightValue: '120', repsValue: '5' }),
      ],
    });
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: 'bench',
      exercises: [tiedExercise],
      historicalBestEstimatedOneRepMax: 1,
    });

    expect(record?.setId).toBe('set-a');
  });
});

describe('deriveSessionPersonalRecords', () => {
  it('uses only earlier completed, non-deleted history in (completedAt, sessionId) order', () => {
    const target = completedSession({
      sessionId: 'target-b',
      exercises: [
        insightExercise({
          id: 'target-row',
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          sets: [insightSet('target-set', { weightValue: '110' })],
        }),
      ],
    });
    const historyExercise = (weightValue: string) => [
      insightExercise({
        id: `history-${weightValue}`,
        exerciseDefinitionId: 'bench',
        sets: [insightSet(`history-set-${weightValue}`, { weightValue })],
      }),
    ];
    const records = deriveSessionPersonalRecords({
      targetSession: target,
      historicalSessions: [
        completedSession({
          sessionId: 'earlier',
          completedAt: new Date('2026-09-11T10:00:00.000Z'),
          exercises: historyExercise('100'),
        }),
        completedSession({ sessionId: 'target-a', exercises: historyExercise('105') }),
        completedSession({ sessionId: 'target-c', exercises: historyExercise('500') }),
        completedSession({
          sessionId: 'deleted',
          completedAt: new Date('2026-09-10T10:00:00.000Z'),
          deletedAt: AT,
          exercises: historyExercise('600'),
        }),
        completedSession({
          sessionId: 'later',
          completedAt: new Date('2026-09-13T10:00:00.000Z'),
          exercises: historyExercise('700'),
        }),
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0].historicalBestEstimatedOneRepMax).toBeCloseTo(
      estimateOneRepMax(105, 5) as number
    );
  });

  it('deduplicates repeated definition blocks and follows first exercise order', () => {
    const target = completedSession({
      sessionId: 'target',
      exercises: [
        insightExercise({
          id: 'curl-row',
          exerciseDefinitionId: 'curl',
          exerciseName: 'Curl',
          orderIndex: 0,
          sets: [insightSet('curl-set', { weightValue: '30' })],
        }),
        insightExercise({
          id: 'bench-row-a',
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          orderIndex: 1,
          sets: [insightSet('bench-set-a', { weightValue: '110' })],
        }),
        insightExercise({
          id: 'bench-row-b',
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          orderIndex: 2,
          sets: [insightSet('bench-set-b', { weightValue: '120' })],
        }),
        insightExercise({
          id: 'unlinked',
          exerciseDefinitionId: null,
          orderIndex: 3,
          sets: [insightSet('unlinked-set', { weightValue: '900' })],
        }),
      ],
    });
    const history = completedSession({
      sessionId: 'history',
      completedAt: new Date('2026-09-01T10:00:00.000Z'),
      exercises: [
        insightExercise({
          id: 'history-bench',
          exerciseDefinitionId: 'bench',
          sets: [insightSet('history-bench-set', { weightValue: '100' })],
        }),
        insightExercise({
          id: 'history-curl',
          exerciseDefinitionId: 'curl',
          orderIndex: 1,
          sets: [insightSet('history-curl-set', { weightValue: '20' })],
        }),
      ],
    });

    const records = deriveSessionPersonalRecords({
      targetSession: target,
      historicalSessions: [history],
    });

    expect(records.map((record) => record.exerciseDefinitionId)).toEqual(['curl', 'bench']);
    expect(records[1]).toEqual(
      expect.objectContaining({
        sessionExerciseOrderIndex: 1,
        sessionExerciseId: 'bench-row-b',
        setId: 'bench-set-b',
      })
    );
  });

  it('omits no-baseline exercises and deleted target work', () => {
    const target = completedSession({
      sessionId: 'target',
      exercises: [
        insightExercise({
          id: 'new-exercise',
          exerciseDefinitionId: 'new',
          sets: [insightSet('new-set', { weightValue: '500' })],
        }),
        insightExercise({
          id: 'deleted-exercise',
          exerciseDefinitionId: 'bench',
          deletedAt: AT,
          sets: [insightSet('deleted-exercise-set', { weightValue: '500' })],
        }),
        insightExercise({
          id: 'bench',
          exerciseDefinitionId: 'bench',
          orderIndex: 2,
          sets: [insightSet('deleted-set', { weightValue: '500', deletedAt: AT })],
        }),
      ],
    });
    const history = completedSession({
      sessionId: 'history',
      completedAt: new Date('2026-09-01T10:00:00.000Z'),
      exercises: [
        insightExercise({
          id: 'history-bench',
          exerciseDefinitionId: 'bench',
          sets: [insightSet('history-set')],
        }),
      ],
    });

    expect(
      deriveSessionPersonalRecords({ targetSession: target, historicalSessions: [history] })
    ).toEqual([]);
  });
});

describe('createCompletedSessionInsightsRepository', () => {
  const buildStore = (overrides: Partial<SessionInsightsStore> = {}): SessionInsightsStore => ({
    loadTargetSession: jest.fn().mockResolvedValue(null),
    loadEarlierCompletedSessions: jest.fn().mockResolvedValue([]),
    loadSessionExercises: jest.fn().mockResolvedValue([]),
    loadExerciseSets: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('returns null without loading children when the target is unavailable', async () => {
    const store = buildStore();
    const repository = createCompletedSessionInsightsRepository(store);

    await expect(repository.loadPersonalRecords('missing')).resolves.toBeNull();
    expect(store.loadEarlierCompletedSessions).not.toHaveBeenCalled();
    expect(store.loadSessionExercises).not.toHaveBeenCalled();
  });

  it('assembles target and historical graphs before applying the shared PR calculation', async () => {
    const target = completedSession({ sessionId: 'target' });
    const history = completedSession({
      sessionId: 'history',
      completedAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    const store = buildStore({
      loadTargetSession: jest.fn().mockResolvedValue(target),
      loadEarlierCompletedSessions: jest.fn().mockResolvedValue([history]),
      loadSessionExercises: jest.fn().mockResolvedValue([
        {
          id: 'target-row',
          sessionId: 'target',
          orderIndex: 0,
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          deletedAt: null,
        },
        {
          id: 'history-row',
          sessionId: 'history',
          orderIndex: 0,
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          deletedAt: null,
        },
      ]),
      loadExerciseSets: jest.fn().mockResolvedValue([
        {
          ...insightSet('target-set', { weightValue: '110' }),
          sessionExerciseId: 'target-row',
        },
        {
          ...insightSet('history-set', { weightValue: '100' }),
          sessionExerciseId: 'history-row',
        },
      ]),
    });
    const repository = createCompletedSessionInsightsRepository(store);

    const records = await repository.loadPersonalRecords('target');

    expect(store.loadEarlierCompletedSessions).toHaveBeenCalledWith({
      completedAt: AT,
      targetSessionId: 'target',
    });
    expect(records).toEqual([
      expect.objectContaining({ exerciseDefinitionId: 'bench', setId: 'target-set' }),
    ]);
  });
});
