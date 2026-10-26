import { estimateOneRepMax } from '@/src/exercise-calculations';
import {
  aggregateExerciseHistory,
  createExerciseHistoryRepository,
  type ExerciseHistoryAggregationInput,
  type ExerciseHistorySessionRecordRow,
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
    period: overrides.period ?? { weeks: 52, kind: 'history' },
    appliedTagDefinitionId: overrides.appliedTagDefinitionId ?? null,
    // Three-state: left out unless an override names a gym (`null` included).
    ...('appliedGymId' in overrides ? { appliedGymId: overrides.appliedGymId } : {}),
    sessionsInPeriod,
    allTimeBest: overrides.allTimeBest ?? NO_BEST,
    setsBySessionExerciseId: overrides.setsBySessionExerciseId ?? groupBy(setRows),
    tagsBySessionExerciseId: overrides.tagsBySessionExerciseId ?? groupBy(tagRows),
    ...(overrides.recordsBySessionId ? { recordsBySessionId: overrides.recordsBySessionId } : {}),
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
      { gymId: null, name: 'No gym', occurrenceCount: 1 },
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

  it('filters sessions to the sessions with no gym when appliedGymId is null', () => {
    const summary = aggregateExerciseHistory(
      buildInput({
        appliedGymId: null,
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

describe('aggregateExerciseHistory records', () => {
  // s1 holds two blocks of the exercise; s2 one. s1's 1RM set is in its
  // second block, its top-weight set in its first.
  const sessionsInPeriod = [
    sessionRow({ sessionId: 's1', sessionExerciseId: 'se1a', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a' }),
    sessionRow({ sessionId: 's1', sessionExerciseId: 'se1b', completedAt: new Date('2026-05-12T16:00:00.000Z'), gymId: 'gym-a' }),
    sessionRow({ sessionId: 's2', sessionExerciseId: 'se2', completedAt: new Date('2026-05-15T16:00:00.000Z'), gymId: 'gym-a' }),
  ];
  const setsBySessionExerciseId = groupBy([
    setRow({ setId: 'a1', sessionExerciseId: 'se1a', orderIndex: 0, weightValue: '120', repsValue: '2' }),
    setRow({ setId: 'b1', sessionExerciseId: 'se1b', orderIndex: 0, weightValue: '100', repsValue: '10' }),
    setRow({ setId: 'c1', sessionExerciseId: 'se2', orderIndex: 0, weightValue: '90', repsValue: '5' }),
  ]);
  const recordRow = (overrides: Partial<ExerciseHistorySessionRecordRow> & { sessionId: string }): ExerciseHistorySessionRecordRow => ({
    bestE1rmKg: null, bestE1rmSetId: null, topWeightSetId: null, volumeKg: null,
    prE1rm: false, prWeight: false, prVolume: false, ownPrE1rm: false, ownPrWeight: false, ownPrVolume: false,
    ...overrides,
  });
  // Whole-exercise PRs on s1 only; s2 took its gym's own 1RM, not the whole exercise's.
  const recordsBySessionId = new Map([
    ['s1', recordRow({
      sessionId: 's1', bestE1rmKg: 133.3, bestE1rmSetId: 'b1', topWeightSetId: 'a1', volumeKg: 1240,
      prE1rm: true, prWeight: true, prVolume: true,
    })],
    ['s2', recordRow({ sessionId: 's2', bestE1rmKg: 101.3, bestE1rmSetId: 'c1', topWeightSetId: 'c1', volumeKg: 450, ownPrE1rm: true })],
  ]);
  const recordsOf = (summary: ReturnType<typeof aggregateExerciseHistory>) =>
    Object.fromEntries(summary.sessions.map((entry) => [entry.sessionExerciseId, entry.records]));

  it('marks the whole exercise\'s PRs with every gym in view: each set on its block, Volume on the first', () => {
    const summary = aggregateExerciseHistory(buildInput({
      sessionsInPeriod, setsBySessionExerciseId, tagsBySessionExerciseId: {}, recordsBySessionId,
    }));
    expect(recordsOf(summary)).toEqual({
      se2: null,
      se1a: { oneRepMax: null, topWeightSetId: 'a1', volumeKg: 1240 },
      se1b: { oneRepMax: { setId: 'b1', valueKg: 133.3 }, topWeightSetId: null, volumeKg: null },
    });
  });

  it('marks each session\'s own PRs with a gym chosen', () => {
    const summary = aggregateExerciseHistory(buildInput({
      sessionsInPeriod, setsBySessionExerciseId, tagsBySessionExerciseId: {}, recordsBySessionId, appliedGymId: 'gym-a',
    }));
    expect(recordsOf(summary)).toEqual({
      se2: { oneRepMax: { setId: 'c1', valueKg: 101.3 }, topWeightSetId: null, volumeKg: null },
      se1a: null,
      se1b: null,
    });
  });

  it('leaves records off a session without stored facts, and off every entry without a records read', () => {
    const withoutS1 = aggregateExerciseHistory(buildInput({
      sessionsInPeriod, setsBySessionExerciseId, tagsBySessionExerciseId: {},
      recordsBySessionId: new Map([['s2', recordsBySessionId.get('s2')!]]), appliedGymId: 'gym-a',
    }));
    expect(recordsOf(withoutS1).se1a).toBeNull();
    const unread = aggregateExerciseHistory(buildInput({ sessionsInPeriod, setsBySessionExerciseId, tagsBySessionExerciseId: {} }));
    expect(unread.sessions.every((entry) => entry.records === undefined)).toBe(true);
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
    loadGymName: jest.fn().mockResolvedValue(null),
    loadSessionRecords: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('reads every session\'s stored records for the exercise and marks the listed blocks', async () => {
    const loadSessionRecords = jest.fn().mockResolvedValue([{
      sessionId: 's1', bestE1rmKg: 116.7, bestE1rmSetId: 'st-1', topWeightSetId: 'st-1', volumeKg: 500,
      prE1rm: true, prWeight: true, prVolume: false, ownPrE1rm: true, ownPrWeight: true, ownPrVolume: false,
    }]);
    const repo = createExerciseHistoryRepository(buildStore({
      loadSessionsForExercise: jest.fn().mockResolvedValue([
        sessionRow({ sessionId: 's1', sessionExerciseId: 'se1', completedAt: new Date('2026-05-12T16:00:00.000Z') }),
      ]),
      loadSetsForSessionExercises: jest.fn().mockResolvedValue([
        setRow({ setId: 'st-1', sessionExerciseId: 'se1', orderIndex: 0 }),
      ]),
      loadSessionRecords,
    }));
    const summary = await repo.load({ exerciseDefinitionId: 'ex-bench', now: new Date('2026-05-13T12:00:00.000Z') });
    expect(loadSessionRecords).toHaveBeenCalledWith({ exerciseDefinitionId: 'ex-bench' });
    expect(summary?.sessions[0]?.records).toEqual({
      oneRepMax: { setId: 'st-1', valueKg: 116.7 }, topWeightSetId: 'st-1', volumeKg: null,
    });
  });

  it('returns null when the exercise definition is missing', async () => {
    const repo = createExerciseHistoryRepository(
      buildStore({ loadExerciseDefinition: jest.fn().mockResolvedValue(null) })
    );
    const summary = await repo.load({ exerciseDefinitionId: 'missing' });
    expect(summary).toBeNull();
  });

  it('uses calendar weeks for the one-week view and explicit bounds for configured history', async () => {
    const loadSessionsForExercise = jest.fn().mockResolvedValue([]);
    const repo = createExerciseHistoryRepository(buildStore({ loadSessionsForExercise }));

    const now = new Date('2026-05-19T15:00:00.000Z');
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: { weeks: 1, kind: 'progress' }, now });
    // One session read, for the period window; the all-time bests come from the facts.
    expect(loadSessionsForExercise).toHaveBeenCalledTimes(1);
    expect(loadSessionsForExercise).toHaveBeenLastCalledWith({
      exerciseDefinitionId: 'ex-bench',
      start: new Date(2026, 4, 18),
      end: now,
    });
  });

  it.each([
    { kind: 'all' as const, start: null },
    { kind: 'history' as const, weeks: 3, start: new Date(2026, 3, 27) },
    { kind: 'progress' as const, weeks: 3, start: new Date(2026, 4, 4) },
  ])('reads the configured $kind calendar window', async ({ kind, weeks, start }) => {
    const store = buildStore();
    const now = new Date(2026, 4, 19, 16);
    await createExerciseHistoryRepository(store).load({ exerciseDefinitionId: exerciseDefinition.id,
      period: kind === 'all' ? { kind } : { kind, weeks: weeks! }, now });
    expect(store.loadSessionsForExercise).toHaveBeenCalledWith({ exerciseDefinitionId: exerciseDefinition.id, start, end: now });
  });

  it('reads the all-time best for the applied gym, never by period or tag', async () => {
    const best = {
      estimatedOneRepMax: null,
      topWeight: { weight: 150, reps: 3, sessionId: 's-old', completedAt: new Date('2025-12-01T16:00:00.000Z') },
    };
    const loadAllTimeBest = jest.fn().mockResolvedValue(best);
    const repo = createExerciseHistoryRepository(buildStore({ loadAllTimeBest }));

    const summary = await repo.load({ exerciseDefinitionId: exerciseDefinition.id, period: { weeks: 1, kind: 'progress' }, tagDefinitionId: 'tag-a' });
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, gymId: 'gym-a' });
    await repo.load({ exerciseDefinitionId: exerciseDefinition.id, gymId: null });

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
