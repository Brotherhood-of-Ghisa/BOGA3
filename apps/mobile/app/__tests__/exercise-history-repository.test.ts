import {
  aggregateExerciseHistory,
  createExerciseHistoryRepository,
  type ExerciseHistoryAggregationInput,
  type ExerciseHistorySessionRow,
  type ExerciseHistorySetRow,
  type ExerciseHistoryStore,
  type ExerciseHistoryTagRow,
} from '@/src/data/exercise-history';

const exerciseDefinition = {
  id: 'ex-bench',
  name: 'Bench Press',
  deletedAt: null,
};

const sessionRow = (
  overrides: Partial<ExerciseHistorySessionRow> & {
    sessionId: string;
    sessionExerciseId: string;
    completedAt: Date;
  }
): ExerciseHistorySessionRow => ({
  gymName: null,
  ...overrides,
});

const setRow = (
  overrides: Partial<ExerciseHistorySetRow> & { setId: string; sessionExerciseId: string; orderIndex: number }
): ExerciseHistorySetRow => ({
  weightValue: '100',
  repsValue: '5',
  setType: null,
  ...overrides,
});

const tagRow = (
  overrides: Partial<ExerciseHistoryTagRow> & {
    sessionExerciseId: string;
    tagDefinitionId: string;
    name: string;
  }
): ExerciseHistoryTagRow => ({
  deletedAt: null,
  ...overrides,
});

const groupBy = <T extends { sessionExerciseId: string }>(rows: T[]): Record<string, T[]> => {
  const result: Record<string, T[]> = {};
  for (const row of rows) {
    const bucket = result[row.sessionExerciseId];
    if (bucket) {
      bucket.push(row);
    } else {
      result[row.sessionExerciseId] = [row];
    }
  }
  return result;
};

const buildInput = (
  overrides: Partial<ExerciseHistoryAggregationInput> = {}
): ExerciseHistoryAggregationInput => {
  const sessionsInPeriod = overrides.sessionsInPeriod ?? [
    sessionRow({
      sessionId: 's1',
      sessionExerciseId: 'se1',
      completedAt: new Date('2026-05-12T16:00:00.000Z'),
      gymName: 'Westside',
    }),
    sessionRow({
      sessionId: 's2',
      sessionExerciseId: 'se2',
      completedAt: new Date('2026-05-15T16:00:00.000Z'),
      gymName: null,
    }),
  ];
  const setRows = overrides.setsBySessionExerciseId
    ? Object.values(overrides.setsBySessionExerciseId).flat()
    : [
        setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '45', repsValue: '10', setType: 'warm_up' }),
        setRow({ setId: 'st-2', sessionExerciseId: 'se1', orderIndex: 1, weightValue: '100', repsValue: '8' }),
        setRow({ setId: 'st-3', sessionExerciseId: 'se1', orderIndex: 2, weightValue: '100', repsValue: '6', setType: 'rir_1' }),
        setRow({ setId: 'st-4', sessionExerciseId: 'se2', orderIndex: 0, weightValue: '110', repsValue: '5' }),
        setRow({ setId: 'st-5', sessionExerciseId: 'se2', orderIndex: 1, weightValue: '110', repsValue: '4' }),
      ];
  const tagRows = overrides.tagsBySessionExerciseId
    ? Object.values(overrides.tagsBySessionExerciseId).flat()
    : [
        tagRow({ sessionExerciseId: 'se1', tagDefinitionId: 'tag-westside', name: 'Westside grip' }),
        tagRow({ sessionExerciseId: 'se2', tagDefinitionId: 'tag-wide', name: 'Wide grip' }),
      ];

  return {
    exerciseDefinition,
    period: overrides.period ?? 30,
    appliedTagDefinitionId: overrides.appliedTagDefinitionId ?? null,
    sessionsInPeriod,
    sessionsAllTime: overrides.sessionsAllTime ?? sessionsInPeriod,
    setsBySessionExerciseId: overrides.setsBySessionExerciseId ?? groupBy(setRows),
    tagsBySessionExerciseId: overrides.tagsBySessionExerciseId ?? groupBy(tagRows),
  };
};

describe('aggregateExerciseHistory', () => {
  it('orders sessions newest first and includes warm-ups in per-session metrics', () => {
    const summary = aggregateExerciseHistory(buildInput());

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s2', 's1']);

    const benchFirst = summary.sessions.find((entry) => entry.sessionId === 's1');
    expect(benchFirst?.workingSetCount).toBe(2);
    expect(benchFirst?.totalVolume).toBe(45 * 10 + 100 * 8 + 100 * 6);
    expect(benchFirst?.topWeightSet).toEqual({ weight: 100, reps: 8 });
    expect(benchFirst?.estimatedOneRepMax).not.toBeNull();
    // Warm-up set is still visually flagged isWorking=false.
    expect(benchFirst?.sets).toHaveLength(3);
    expect(benchFirst?.sets[0].isWorking).toBe(false);
    expect(benchFirst?.sets[0].setType).toBe('warm_up');
  });

  it('tie-breaks top weight by max reps at that weight', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '100', repsValue: '6' }),
          setRow({ setId: 'st-2', sessionExerciseId: 'se1', orderIndex: 1, weightValue: '100', repsValue: '8' }),
          setRow({ setId: 'st-3', sessionExerciseId: 'se1', orderIndex: 2, weightValue: '95', repsValue: '10' }),
        ]),
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
        ],
        sessionsAllTime: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
        ],
      })
    );

    const entry = summary.sessions[0];
    expect(entry.topWeightSet).toEqual({ weight: 100, reps: 8 });
  });

  it('builds tag occurrence counts from the period (unfiltered) and sorts by count desc then name', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        tagsBySessionExerciseId: groupBy([
          tagRow({ sessionExerciseId: 'se1', tagDefinitionId: 'tag-a', name: 'Bravo' }),
          tagRow({ sessionExerciseId: 'se2', tagDefinitionId: 'tag-a', name: 'Bravo' }),
          tagRow({ sessionExerciseId: 'se2', tagDefinitionId: 'tag-b', name: 'Alpha' }),
        ]),
      })
    );

    expect(summary.tagOptions.map((option) => option.tagDefinitionId)).toEqual(['tag-a', 'tag-b']);
    expect(summary.tagOptions[0].occurrenceCount).toBe(2);
    expect(summary.tagOptions[1].occurrenceCount).toBe(1);
  });

  it('filters sessions to those carrying the applied tag', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        appliedTagDefinitionId: 'tag-westside',
      })
    );

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s1']);
    // Tag options still reflect the full period
    expect(summary.tagOptions.map((option) => option.tagDefinitionId).sort()).toEqual([
      'tag-westside',
      'tag-wide',
    ]);
  });

  it('computes all-time best from the all-time pool, independent of the period filter', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        // Period has lighter sets; all-time has a heavier session not in period.
        sessionsInPeriod: [
          sessionRow({ sessionId: 's-recent', sessionExerciseId: 'se-recent', completedAt: new Date('2026-05-15T16:00:00.000Z') }),
        ],
        sessionsAllTime: [
          sessionRow({ sessionId: 's-recent', sessionExerciseId: 'se-recent', completedAt: new Date('2026-05-15T16:00:00.000Z') }),
          sessionRow({ sessionId: 's-old', sessionExerciseId: 'se-old', completedAt: new Date('2025-12-01T16:00:00.000Z') }),
        ],
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'r1', sessionExerciseId: 'se-recent', orderIndex: 0, weightValue: '80', repsValue: '5' }),
          setRow({ setId: 'o1', sessionExerciseId: 'se-old', orderIndex: 0, weightValue: '150', repsValue: '3' }),
        ]),
        tagsBySessionExerciseId: {},
      })
    );

    expect(summary.allTimeBest.topWeight?.weight).toBe(150);
    expect(summary.allTimeBest.topWeight?.sessionId).toBe('s-old');
    expect(summary.allTimeBest.estimatedOneRepMax?.sessionId).toBe('s-old');
  });

  it('returns an empty session list and null best when no sessions are present', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [],
        sessionsAllTime: [],
        setsBySessionExerciseId: {},
        tagsBySessionExerciseId: {},
      })
    );

    expect(summary.sessions).toEqual([]);
    expect(summary.tagOptions).toEqual([]);
    expect(summary.allTimeBest).toEqual({ estimatedOneRepMax: null, topWeight: null });
  });

  it('surfaces deleted tags so chips remain visible for past assignments', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        tagsBySessionExerciseId: groupBy([
          tagRow({
            sessionExerciseId: 'se1',
            tagDefinitionId: 'tag-deleted',
            name: 'Old grip',
            deletedAt: new Date('2026-04-01T00:00:00.000Z'),
          }),
        ]),
      })
    );

    expect(summary.tagOptions[0].deletedAt).not.toBeNull();
    const benchEntry = summary.sessions.find((entry) => entry.sessionId === 's1');
    expect(benchEntry?.tagIds).toContain('tag-deleted');
  });

  it('returns null estimated 1RM and zero volume when no set parses cleanly', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
        ],
        sessionsAllTime: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
        ],
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '', repsValue: '' }),
        ]),
        tagsBySessionExerciseId: {},
      })
    );

    const entry = summary.sessions[0];
    expect(entry.estimatedOneRepMax).toBeNull();
    expect(entry.totalVolume).toBe(0);
    expect(entry.topWeightSet).toBeNull();
    expect(entry.workingSetCount).toBe(1); // set is non-warm-up
  });
});

describe('createExerciseHistoryRepository', () => {
  const buildStore = (
    overrides: Partial<ExerciseHistoryStore> = {}
  ): ExerciseHistoryStore => ({
    loadExerciseDefinition: jest.fn().mockResolvedValue(exerciseDefinition),
    loadSessionsForExercise: jest.fn().mockResolvedValue([]),
    loadSetsForSessionExercises: jest.fn().mockResolvedValue([]),
    loadTagsForSessionExercises: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('returns null when the exercise definition is missing', async () => {
    const repo = createExerciseHistoryRepository(
      buildStore({ loadExerciseDefinition: jest.fn().mockResolvedValue(null) })
    );
    const summary = await repo.load({ exerciseDefinitionId: 'missing' });
    expect(summary).toBeNull();
  });

  it('uses computePeriodBounds for 7/30 day periods and skips bounds for "all"', async () => {
    const loadSessionsForExercise = jest.fn().mockResolvedValue([]);
    const repo = createExerciseHistoryRepository(buildStore({ loadSessionsForExercise }));

    const now = new Date('2026-05-19T15:00:00.000Z');
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 7, now });
    // Bounded period: two calls (period window + all-time). The bounded one carries the dates.
    const sevenDayCalls = loadSessionsForExercise.mock.calls.map((args) => args[0]);
    expect(sevenDayCalls).toContainEqual(
      expect.objectContaining({
        exerciseDefinitionId: 'ex-bench',
        start: new Date('2026-05-12T15:00:00.000Z'),
        end: now,
      })
    );
    expect(sevenDayCalls).toContainEqual(
      expect.objectContaining({ start: null, end: null })
    );

    loadSessionsForExercise.mockClear();
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 'all', now });
    // "all" period: single call with null bounds.
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(1);
    expect(loadSessionsForExercise).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: null, end: null })
    );
  });

  it('only loads the all-time session list when a bounded period is requested', async () => {
    const loadSessionsForExercise = jest.fn().mockResolvedValue([]);
    const repo = createExerciseHistoryRepository(buildStore({ loadSessionsForExercise }));

    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 'all' });
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(1);

    loadSessionsForExercise.mockClear();
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 30 });
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(2);
  });
});
