import { estimateOneRepMax } from '@/src/exercise-calculations';
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
  bodyweightContribution: 0,
  bodyweightCalculationsEnabled: false,
  loadInputMode: 'total_load' as const,
};

const sessionRow = (
  overrides: Partial<ExerciseHistorySessionRow> & {
    sessionId: string;
    sessionExerciseId: string;
    completedAt: Date;
  }
): ExerciseHistorySessionRow => ({
  gymName: null,
  bodyWeightKg: null,
  bodyWeightSource: null,
  bodyWeightMeasurementId: null,
  bodyWeightMeasuredAt: null,
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

const NO_BEST = { estimatedOneRepMax: null, topWeight: null };

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
    appliedGymId: overrides.appliedGymId ?? null,
    sessionsInPeriod,
    allTimeBest: overrides.allTimeBest ?? NO_BEST,
    setsBySessionExerciseId: overrides.setsBySessionExerciseId ?? groupBy(setRows),
    tagsBySessionExerciseId: overrides.tagsBySessionExerciseId ?? groupBy(tagRows),
  };
};

describe('aggregateExerciseHistory', () => {
  it('orders sessions newest first; per-session volume reads working sets only', () => {
    const summary = aggregateExerciseHistory(buildInput());

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s2', 's1']);

    const benchFirst = summary.sessions.find((entry) => entry.sessionId === 's1');
    expect(benchFirst?.workingSetCount).toBe(2);
    // The 45 × 10 warm-up keeps its row but adds no volume.
    expect(benchFirst?.totalVolume).toBe(100 * 8 + 100 * 6);
    expect(benchFirst?.topWeightSet).toEqual({ weight: 100, reps: 8 });
    expect(benchFirst?.estimatedOneRepMax).not.toBeNull();
    // Only the warm-up is flagged isWorking=false; an untagged set is working.
    expect(benchFirst?.sets).toHaveLength(3);
    expect(benchFirst?.sets[0].isWorking).toBe(false);
    expect(benchFirst?.sets[0].setType).toBe('warm_up');
    expect(benchFirst?.sets[1].isWorking).toBe(true);
    expect(benchFirst?.sets[1].setType).toBeNull();
  });

  it('never takes a warm-up heavier than the working sets as the 1RM or top set', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '200', repsValue: '5', setType: 'warm_up' }),
          setRow({ setId: 'st-2', sessionExerciseId: 'se1', orderIndex: 1, weightValue: '100', repsValue: '5', setType: 'rir_1' }),
          setRow({ setId: 'st-3', sessionExerciseId: 'se2', orderIndex: 0, weightValue: '90', repsValue: '5' }),
        ]),
      })
    );

    const withWarmUp = summary.sessions.find((entry) => entry.sessionId === 's1');
    // The warm-up row still shows; it just is not a best.
    expect(withWarmUp?.sets.map((set) => set.setType)).toEqual(['warm_up', 'rir_1']);
    expect(withWarmUp?.topWeightSet).toEqual({ weight: 100, reps: 5 });
    expect(withWarmUp?.estimatedOneRepMax).toBeCloseTo(estimateOneRepMax(100, 5) as number, 8);
  });

  it('keeps a warm-up-only session with its rows, but no 1RM, top set or volume', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '60', repsValue: '10', setType: 'warm_up' }),
          setRow({ setId: 'st-2', sessionExerciseId: 'se2', orderIndex: 0, weightValue: '90', repsValue: '5' }),
        ]),
      })
    );

    const warmUpOnly = summary.sessions.find((entry) => entry.sessionId === 's1');
    expect(warmUpOnly?.sets.map((set) => set.setId)).toEqual(['st-1']);
    expect(warmUpOnly).toMatchObject({ workingSetCount: 0, totalVolume: 0, estimatedOneRepMax: null, topWeightSet: null });
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

  it('counts in a chip only the cards it shows: rows with a performed set', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
          sessionRow({ sessionId: 's2', sessionExerciseId: 'se2', completedAt: new Date('2026-05-13T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
        ],
        tagsBySessionExerciseId: groupBy([
          tagRow({ sessionExerciseId: 'se1', tagDefinitionId: 'tag-a', name: 'Bravo' }),
          tagRow({ sessionExerciseId: 'se2', tagDefinitionId: 'tag-a', name: 'Bravo' }),
        ]),
        setsBySessionExerciseId: {
          se1: [setRow({ setId: 'st1', sessionExerciseId: 'se1', orderIndex: 0 })],
          se2: [setRow({ setId: 'st2', sessionExerciseId: 'se2', orderIndex: 0, performanceStatus: 'unperformed' })],
        },
      })
    );

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s1']);
    expect(summary.tagOptions[0].occurrenceCount).toBe(1);
    expect(summary.gymOptions).toEqual([{ gymId: 'gym-a', name: 'Alpha Gym', occurrenceCount: 1 }]);
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

  it('builds gym occurrence counts from the period and sorts by count desc then name', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
          sessionRow({ sessionId: 's2', sessionExerciseId: 'se2', completedAt: new Date('2026-05-13T16:00:00.000Z'), gymId: 'gym-b', gymName: 'Beta Gym' }),
          sessionRow({ sessionId: 's3', sessionExerciseId: 'se3', completedAt: new Date('2026-05-14T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
          sessionRow({ sessionId: 's4', sessionExerciseId: 'se4', completedAt: new Date('2026-05-15T16:00:00.000Z'), gymId: null, gymName: null }),
        ],
        setsBySessionExerciseId: {
          se1: [setRow({ setId: 'st1', sessionExerciseId: 'se1', orderIndex: 0 })],
          se2: [setRow({ setId: 'st2', sessionExerciseId: 'se2', orderIndex: 0 })],
          se3: [setRow({ setId: 'st3', sessionExerciseId: 'se3', orderIndex: 0 })],
          se4: [setRow({ setId: 'st4', sessionExerciseId: 'se4', orderIndex: 0 })],
        },
      })
    );

    expect(summary.gymOptions).toEqual([
      { gymId: 'gym-a', name: 'Alpha Gym', occurrenceCount: 2 },
      { gymId: 'gym-b', name: 'Beta Gym', occurrenceCount: 1 },
      { gymId: 'no-gym', name: 'No gym', occurrenceCount: 1 },
    ]);
  });

  it('filters sessions to those matching the applied gym ID', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        appliedGymId: 'gym-b',
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
          sessionRow({ sessionId: 's2', sessionExerciseId: 'se2', completedAt: new Date('2026-05-13T16:00:00.000Z'), gymId: 'gym-b', gymName: 'Beta Gym' }),
        ],
        setsBySessionExerciseId: {
          se1: [setRow({ setId: 'st1', sessionExerciseId: 'se1', orderIndex: 0 })],
          se2: [setRow({ setId: 'st2', sessionExerciseId: 'se2', orderIndex: 0 })],
        },
      })
    );

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s2']);
    expect(summary.gymOptions).toHaveLength(2);
  });

  it('filters sessions to unassigned gym when appliedGymId is no-gym', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        appliedGymId: 'no-gym',
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a', gymName: 'Alpha Gym' }),
          sessionRow({ sessionId: 's2', sessionExerciseId: 'se2', completedAt: new Date('2026-05-13T16:00:00.000Z'), gymId: null, gymName: null }),
        ],
        setsBySessionExerciseId: {
          se1: [setRow({ setId: 'st1', sessionExerciseId: 'se1', orderIndex: 0 })],
          se2: [setRow({ setId: 'st2', sessionExerciseId: 'se2', orderIndex: 0 })],
        },
      })
    );

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s2']);
  });

  it('returns an empty session list and null best when no sessions are present', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [],
        setsBySessionExerciseId: {},
        tagsBySessionExerciseId: {},
      })
    );

    expect(summary.sessions).toEqual([]);
    expect(summary.tagOptions).toEqual([]);
  });

  it('excludes unconfirmed sets and sessions that contain no confirmed sets', () => {
    const sessions = [
      sessionRow({
        sessionId: 's-confirmed',
        sessionExerciseId: 'se-confirmed',
        completedAt: new Date('2026-05-15T16:00:00.000Z'),
      }),
      sessionRow({
        sessionId: 's-unconfirmed',
        sessionExerciseId: 'se-unconfirmed',
        completedAt: new Date('2026-05-16T16:00:00.000Z'),
      }),
    ];
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: sessions,
        setsBySessionExerciseId: groupBy([
          setRow({
            setId: 'confirmed',
            sessionExerciseId: 'se-confirmed',
            orderIndex: 0,
            weightValue: '100',
            repsValue: '5',
            performanceStatus: null,
          }),
          setRow({
            setId: 'unconfirmed',
            sessionExerciseId: 'se-unconfirmed',
            orderIndex: 0,
            weightValue: '500',
            repsValue: '10',
            performanceStatus: 'unperformed',
          }),
        ]),
        tagsBySessionExerciseId: {},
      })
    );

    expect(summary.sessions.map((entry) => entry.sessionId)).toEqual(['s-confirmed']);
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

  it('omits history sessions when no confirmed set parses cleanly', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        sessionsInPeriod: [
          sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
        ],
        setsBySessionExerciseId: groupBy([
          setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0, weightValue: '', repsValue: '' }),
        ]),
        tagsBySessionExerciseId: {},
      })
    );

    expect(summary.sessions).toEqual([]);
  });

  it('passes the all-time best through: the repository reads it from the facts', () => {
    const allTimeBest = {
      estimatedOneRepMax: { value: 120, sessionId: 's-old', completedAt: new Date('2025-12-01T16:00:00.000Z') },
      topWeight: { weight: 110, reps: 3, sessionId: 's-old', completedAt: new Date('2025-12-01T16:00:00.000Z') },
    };
    expect(aggregateExerciseHistory(buildInput({ allTimeBest })).allTimeBest).toBe(allTimeBest);
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
    loadAllTimeBest: jest.fn().mockResolvedValue(NO_BEST),
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
    // One session read, for the period window; the all-time bests come from the facts.
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(1);
    expect(loadSessionsForExercise).toHaveBeenLastCalledWith({
      exerciseDefinitionId: 'ex-bench',
      start: new Date('2026-05-12T15:00:00.000Z'),
      end: now,
    });

    loadSessionsForExercise.mockClear();
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 'all', now });
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(1);
    expect(loadSessionsForExercise).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: null, end: null })
    );
  });

  it('reads the all-time best for the applied gym, never by period or tag', async () => {
    const best = {
      estimatedOneRepMax: null,
      topWeight: { weight: 150, reps: 3, sessionId: 's-old', completedAt: new Date('2025-12-01T16:00:00.000Z') },
    };
    const loadAllTimeBest = jest.fn().mockResolvedValue(best);
    const repo = createExerciseHistoryRepository(buildStore({ loadAllTimeBest }));

    const summary = await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: 7, tagDefinitionId: 'tag-a' });
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, gymId: 'gym-a' });
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, gymId: 'no-gym' });

    expect(summary?.allTimeBest).toBe(best);
    expect(loadAllTimeBest.mock.calls.map(([input]) => input)).toEqual([
      { exerciseDefinitionId: 'ex-bench' },
      { exerciseDefinitionId: 'ex-bench', gymId: 'gym-a' },
      { exerciseDefinitionId: 'ex-bench', gymId: null },
    ]);
  });

  it('loads one session\'s blocks of the exercise, without tags', async () => {
    const loadSessionsForExercise = jest.fn().mockResolvedValue([
      sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
    ]);
    const loadSetsForSessionExercises = jest.fn().mockResolvedValue([
      setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0 }),
    ]);
    const loadTagsForSessionExercises = jest.fn();
    const repo = createExerciseHistoryRepository(
      buildStore({ loadSessionsForExercise, loadSetsForSessionExercises, loadTagsForSessionExercises })
    );

    const entries = await repo.loadSessionEntries({ exerciseDefinitionId: 'ex-bench', sessionId: 's1' });

    expect(loadSessionsForExercise).toHaveBeenCalledWith({ exerciseDefinitionId: 'ex-bench', sessionId: 's1', start: null, end: null });
    expect(entries.map((entry) => [entry.sessionId, entry.sets.map((set) => set.setId), entry.tagIds])).toEqual([['s1', ['st-1'], []]]);
    expect(loadTagsForSessionExercises).not.toHaveBeenCalled();
    expect(await createExerciseHistoryRepository(buildStore({ loadExerciseDefinition: jest.fn().mockResolvedValue(null) }))
      .loadSessionEntries({ exerciseDefinitionId: 'missing', sessionId: 's1' })).toEqual([]);
  });

  it('loads the exercise\'s blocks completed in a date range', async () => {
    const loadSessionsForExercise = jest.fn().mockResolvedValue([
      sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-10-06T08:00:00.000Z') }),
    ]);
    const repo = createExerciseHistoryRepository(buildStore({ loadSessionsForExercise }));
    const start = new Date('2026-10-05T00:00:00.000Z');
    const end = new Date('2026-10-12T00:00:00.000Z');

    const entries = await repo.loadRangeEntries({ exerciseDefinitionId: 'ex-bench', start, end });

    expect(loadSessionsForExercise).toHaveBeenCalledWith({ exerciseDefinitionId: 'ex-bench', start, end });
    expect(entries.map((entry) => entry.sessionId)).toEqual(['s1']);
    await expect(repo.loadRangeEntries({ exerciseDefinitionId: 'ex-bench', start: new Date('nope'), end }))
      .rejects.toThrow();
  });
});
