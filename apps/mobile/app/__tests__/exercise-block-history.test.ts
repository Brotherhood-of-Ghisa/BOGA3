import {
  DEFAULT_RECENT_EXERCISE_BLOCK_LIMIT,
  aggregateExerciseBlockHistory,
  createExerciseBlockHistoryRepository,
  type ExerciseBlockHistorySessionExerciseRow,
  type ExerciseBlockHistorySessionRow,
  type ExerciseBlockHistorySetRow,
  type ExerciseBlockHistoryStore,
} from '@/src/data/exercise-block-history';

const sessionRow = (
  overrides: Partial<ExerciseBlockHistorySessionRow> & { sessionId: string; completedAt: Date }
): ExerciseBlockHistorySessionRow => ({
  ...overrides,
});

const sessionExerciseRow = (
  overrides: Partial<ExerciseBlockHistorySessionExerciseRow> & {
    sessionExerciseId: string;
    sessionId: string;
  }
): ExerciseBlockHistorySessionExerciseRow => ({
  orderIndex: 0,
  ...overrides,
});

const setRow = (
  overrides: Partial<ExerciseBlockHistorySetRow> & {
    setId: string;
    sessionExerciseId: string;
    orderIndex: number;
  }
): ExerciseBlockHistorySetRow => ({
  weightValue: '100',
  repsValue: '5',
  setType: null,
  ...overrides,
});

const groupBySessionExerciseId = (
  rows: ExerciseBlockHistorySetRow[]
): Record<string, ExerciseBlockHistorySetRow[]> => {
  const grouped: Record<string, ExerciseBlockHistorySetRow[]> = {};
  for (const row of rows) {
    const bucket = grouped[row.sessionExerciseId];
    if (bucket) {
      bucket.push(row);
    } else {
      grouped[row.sessionExerciseId] = [row];
    }
  }
  return grouped;
};

const buildStore = (overrides: Partial<ExerciseBlockHistoryStore> = {}): ExerciseBlockHistoryStore => ({
  loadRecentCompletedSessionsForExercise: jest.fn().mockResolvedValue([]),
  loadSessionExercisesForSessions: jest.fn().mockResolvedValue([]),
  loadSetsForSessionExercises: jest.fn().mockResolvedValue([]),
  ...overrides,
});

describe('aggregateExerciseBlockHistory', () => {
  it('orders newest first and merges duplicate same-exercise rows inside one completed session', () => {
    const summary = aggregateExerciseBlockHistory({
      now: new Date('2026-05-20T12:00:00.000Z'),
      sessions: [
        sessionRow({ sessionId: 'old', completedAt: new Date('2026-05-10T12:00:00.000Z') }),
        sessionRow({ sessionId: 'recent', completedAt: new Date('2026-05-18T12:00:00.000Z') }),
      ],
      sessionExercises: [
        sessionExerciseRow({ sessionId: 'recent', sessionExerciseId: 'recent-a', orderIndex: 1 }),
        sessionExerciseRow({ sessionId: 'recent', sessionExerciseId: 'recent-b', orderIndex: 2 }),
        sessionExerciseRow({ sessionId: 'old', sessionExerciseId: 'old-a', orderIndex: 0 }),
      ],
      setsBySessionExerciseId: groupBySessionExerciseId([
        setRow({ setId: 'ra-1', sessionExerciseId: 'recent-a', orderIndex: 0, weightValue: '100', repsValue: '5' }),
        setRow({ setId: 'rb-1', sessionExerciseId: 'recent-b', orderIndex: 0, weightValue: '120', repsValue: '3' }),
        setRow({ setId: 'old-1', sessionExerciseId: 'old-a', orderIndex: 0, weightValue: '90', repsValue: '6' }),
      ]),
    });

    expect(summary.blocks.map((block) => block.sessionId)).toEqual(['recent', 'old']);

    const recent = summary.blocks[0];
    expect(recent.sessionExerciseIds).toEqual(['recent-a', 'recent-b']);
    expect(recent.totalVolume).toBe(100 * 5 + 120 * 3);
    expect(recent.highestWeight).toBe(120);
    expect(recent.daysAgo).toBe(2);
  });

  it('excludes warm-ups and invalid set values from metrics and <=2 RIR counts', () => {
    const summary = aggregateExerciseBlockHistory({
      now: new Date('2026-05-20T12:00:00.000Z'),
      sessions: [
        sessionRow({ sessionId: 'session-1', completedAt: new Date('2026-05-19T12:00:00.000Z') }),
      ],
      sessionExercises: [
        sessionExerciseRow({ sessionId: 'session-1', sessionExerciseId: 'se-1' }),
      ],
      setsBySessionExerciseId: groupBySessionExerciseId([
        setRow({ setId: 'warm', sessionExerciseId: 'se-1', orderIndex: 0, weightValue: '500', repsValue: '5', setType: 'warm_up' }),
        setRow({ setId: 'rir-good', sessionExerciseId: 'se-1', orderIndex: 1, weightValue: '100', repsValue: '5', setType: 'rir_2' }),
        setRow({ setId: 'rir-invalid', sessionExerciseId: 'se-1', orderIndex: 2, weightValue: 'abc', repsValue: '5', setType: 'rir_1' }),
        setRow({ setId: 'not-rir', sessionExerciseId: 'se-1', orderIndex: 3, weightValue: '90', repsValue: '4', setType: null }),
      ]),
    });

    const block = summary.blocks[0];
    expect(block.totalVolume).toBe(100 * 5 + 90 * 4);
    expect(block.highestWeight).toBe(100);
    expect(block.rirAtMostTwoSetCount).toBe(1);
    expect(block.estimatedOneRepMax).not.toBeNull();
  });

  it('returns empty metrics when no eligible set parses cleanly', () => {
    const summary = aggregateExerciseBlockHistory({
      now: new Date('2026-05-20T12:00:00.000Z'),
      sessions: [
        sessionRow({ sessionId: 'session-1', completedAt: new Date('2026-05-19T12:00:00.000Z') }),
      ],
      sessionExercises: [
        sessionExerciseRow({ sessionId: 'session-1', sessionExerciseId: 'se-1' }),
      ],
      setsBySessionExerciseId: groupBySessionExerciseId([
        setRow({ setId: 'warm', sessionExerciseId: 'se-1', orderIndex: 0, setType: 'warm_up' }),
        setRow({ setId: 'invalid', sessionExerciseId: 'se-1', orderIndex: 1, weightValue: '', repsValue: '0', setType: 'rir_0' }),
      ]),
    });

    expect(summary.blocks[0]).toEqual(
      expect.objectContaining({
        estimatedOneRepMax: null,
        totalVolume: 0,
        highestWeight: null,
        rirAtMostTwoSetCount: 0,
      })
    );
  });

  it('uses session id as a deterministic tie-breaker for identical completion times', () => {
    const completedAt = new Date('2026-05-19T12:00:00.000Z');
    const summary = aggregateExerciseBlockHistory({
      now: new Date('2026-05-20T12:00:00.000Z'),
      sessions: [
        sessionRow({ sessionId: 'session-b', completedAt }),
        sessionRow({ sessionId: 'session-a', completedAt }),
      ],
      sessionExercises: [
        sessionExerciseRow({ sessionId: 'session-b', sessionExerciseId: 'se-b' }),
        sessionExerciseRow({ sessionId: 'session-a', sessionExerciseId: 'se-a' }),
      ],
      setsBySessionExerciseId: {},
    });

    expect(summary.blocks.map((block) => block.sessionId)).toEqual(['session-a', 'session-b']);
  });
});

describe('createExerciseBlockHistoryRepository', () => {
  it('loads the default number of recent sessions before fetching matching exercises and sets', async () => {
    const sessions = [
      sessionRow({ sessionId: 'recent', completedAt: new Date('2026-05-18T12:00:00.000Z') }),
      sessionRow({ sessionId: 'older', completedAt: new Date('2026-05-17T12:00:00.000Z') }),
    ];
    const sessionExercises = [
      sessionExerciseRow({ sessionId: 'recent', sessionExerciseId: 'se-recent' }),
      sessionExerciseRow({ sessionId: 'older', sessionExerciseId: 'se-older' }),
    ];
    const store = buildStore({
      loadRecentCompletedSessionsForExercise: jest.fn().mockResolvedValue(sessions),
      loadSessionExercisesForSessions: jest.fn().mockResolvedValue(sessionExercises),
      loadSetsForSessionExercises: jest.fn().mockResolvedValue([]),
    });

    const repository = createExerciseBlockHistoryRepository(store);
    const summary = await repository.loadRecentBlocks({
      exerciseDefinitionId: 'ex-bench',
      now: new Date('2026-05-20T12:00:00.000Z'),
    });

    expect(store.loadRecentCompletedSessionsForExercise).toHaveBeenCalledWith({
      exerciseDefinitionId: 'ex-bench',
      limit: DEFAULT_RECENT_EXERCISE_BLOCK_LIMIT,
    });
    expect(store.loadSessionExercisesForSessions).toHaveBeenCalledWith({
      exerciseDefinitionId: 'ex-bench',
      sessionIds: ['recent', 'older'],
    });
    expect(store.loadSetsForSessionExercises).toHaveBeenCalledWith({
      sessionExerciseIds: ['se-recent', 'se-older'],
    });
    expect(summary.blocks.map((block) => block.sessionId)).toEqual(['recent', 'older']);
  });

  it('returns an empty result without loading exercises or sets when no recent sessions exist', async () => {
    const store = buildStore({
      loadRecentCompletedSessionsForExercise: jest.fn().mockResolvedValue([]),
      loadSessionExercisesForSessions: jest.fn(),
      loadSetsForSessionExercises: jest.fn(),
    });

    const repository = createExerciseBlockHistoryRepository(store);
    const summary = await repository.loadRecentBlocks({ exerciseDefinitionId: 'ex-bench' });

    expect(summary.blocks).toEqual([]);
    expect(store.loadSessionExercisesForSessions).not.toHaveBeenCalled();
    expect(store.loadSetsForSessionExercises).not.toHaveBeenCalled();
  });

  it('honors a caller-provided limit', async () => {
    const store = buildStore();
    const repository = createExerciseBlockHistoryRepository(store);

    await repository.loadRecentBlocks({ exerciseDefinitionId: 'ex-bench', limit: 2 });

    expect(store.loadRecentCompletedSessionsForExercise).toHaveBeenCalledWith({
      exerciseDefinitionId: 'ex-bench',
      limit: 2,
    });
  });
});
