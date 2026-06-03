import {
  calculateSessionDurationSec,
  createSessionDraftRepository,
  type SessionDraftStore,
  type SessionPersistenceRecord,
} from '@/src/data/session-drafts';

const createMockStore = (): jest.Mocked<SessionDraftStore> => ({
  saveDraftGraph: jest.fn(),
  saveCompletedSessionGraph: jest.fn(),
  loadLatestDraftGraph: jest.fn(),
  loadSessionGraphById: jest.fn(),
  loadSessionById: jest.fn(),
  completeSession: jest.fn(),
  reopenCompletedSession: jest.fn(),
  listCompletedSessions: jest.fn(),
});

const buildSessionRecord = (overrides: Partial<SessionPersistenceRecord> = {}): SessionPersistenceRecord => ({
  id: 'session-1',
  gymId: 'gym-1',
  status: 'active',
  startedAt: new Date('2026-02-20T10:00:00.000Z'),
  completedAt: null,
  durationSec: null,
  deletedAt: null,
  createdAt: new Date('2026-02-20T10:00:00.000Z'),
  updatedAt: new Date('2026-02-20T10:00:00.000Z'),
  ...overrides,
});

describe('session draft repository', () => {
  it('creates/persists draft snapshots through the store API with active default status', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    store.saveDraftGraph.mockResolvedValue({ sessionId: 'session-1' });

    const result = await repository.persistDraftSnapshot({
      gymId: 'gym-1',
      startedAt: new Date('2026-02-20T10:00:00.000Z'),
      exercises: [
        {
          exerciseDefinitionId: 'sys_barbell_bench_press',
          name: 'Bench Press',
          machineName: '',
          sets: [{ repsValue: '5', weightValue: '225' }],
        },
      ],
    });

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(store.saveDraftGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: undefined,
        gymId: 'gym-1',
        status: 'active',
        exercises: [expect.objectContaining({ exerciseDefinitionId: 'sys_barbell_bench_press' })],
      })
    );
  });

  it('loads latest draft snapshots for recorder restoration', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.loadLatestDraftGraph.mockResolvedValue({
      session: buildSessionRecord({ status: 'active', id: 'session-restore' }),
      exercises: [
        {
          id: 'exercise-1',
          sessionId: 'session-restore',
          exerciseDefinitionId: 'sys_barbell_bench_press',
          orderIndex: 0,
          name: 'Bench Press',
          machineName: 'Flat Bench',
          sets: [
            {
              id: 'set-1',
              sessionExerciseId: 'exercise-1',
              orderIndex: 0,
              repsValue: '5',
              weightValue: '225',
              setType: null,
            },
          ],
        },
      ],
    });

    const draft = await repository.loadLatestDraftSnapshot();

    expect(draft).toEqual(
      expect.objectContaining({
        sessionId: 'session-restore',
        status: 'active',
        exercises: [
          expect.objectContaining({
            exerciseDefinitionId: 'sys_barbell_bench_press',
            name: 'Bench Press',
            sets: [expect.objectContaining({ repsValue: '5', weightValue: '225' })],
          }),
        ],
      })
    );
  });

  it('loads a completed session graph by id with ordered exercises and sets', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.loadSessionGraphById.mockResolvedValue({
      session: buildSessionRecord({
        id: 'session-completed',
        status: 'completed',
        completedAt: new Date('2026-02-20T10:45:00.000Z'),
        durationSec: 2700,
      }),
      exercises: [
        {
          id: 'exercise-1',
          sessionId: 'session-completed',
          exerciseDefinitionId: 'sys_barbell_bench_press',
          orderIndex: 0,
          name: 'Bench Press',
          machineName: 'Flat Bench',
          sets: [
            {
              id: 'set-1',
              sessionExerciseId: 'exercise-1',
              orderIndex: 0,
              repsValue: '5',
              weightValue: '225',
              setType: null,
            },
            {
              id: 'set-2',
              sessionExerciseId: 'exercise-1',
              orderIndex: 1,
              repsValue: '4',
              weightValue: '225',
              setType: null,
            },
          ],
        },
        {
          id: 'exercise-2',
          sessionId: 'session-completed',
          exerciseDefinitionId: 'sys_incline_dumbbell_press',
          orderIndex: 1,
          name: 'Incline DB Press',
          machineName: null,
          sets: [
            {
              id: 'set-3',
              sessionExerciseId: 'exercise-2',
              orderIndex: 0,
              repsValue: '10',
              weightValue: '70',
              setType: null,
            },
          ],
        },
      ],
    });

    const snapshot = await repository.loadSessionSnapshotById('session-completed');

    expect(snapshot).toEqual(
      expect.objectContaining({
        sessionId: 'session-completed',
        status: 'completed',
        completedAt: new Date('2026-02-20T10:45:00.000Z'),
        durationSec: 2700,
      })
    );
    expect(snapshot?.exercises.map((exercise) => exercise.name)).toEqual(['Bench Press', 'Incline DB Press']);
    expect(snapshot?.exercises[0]?.sets.map((set) => set.id)).toEqual(['set-1', 'set-2']);
  });

  it('persists completed-session edits through a dedicated store contract and recomputes duration', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T10:46:00.000Z');

    store.saveDraftGraph.mockRejectedValue(new Error('Cannot modify completed session session-completed'));
    store.saveCompletedSessionGraph.mockResolvedValue({ sessionId: 'session-completed' });

    const result = await repository.persistCompletedSessionSnapshot(
      {
        sessionId: 'session-completed',
        gymId: 'gym-2',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
        completedAt: new Date('2026-02-20T10:45:30.000Z'),
        exercises: [
          {
            id: 'exercise-1',
            exerciseDefinitionId: 'sys_barbell_bench_press',
            name: 'Bench Press',
            sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
          },
        ],
      },
      { now }
    );

    expect(result).toEqual({
      sessionId: 'session-completed',
      completedAt: new Date('2026-02-20T10:45:30.000Z'),
      durationSec: 2730,
    });
    expect(store.saveCompletedSessionGraph).toHaveBeenCalledWith({
      sessionId: 'session-completed',
      gymId: 'gym-2',
      startedAt: new Date('2026-02-20T10:00:00.000Z'),
      completedAt: new Date('2026-02-20T10:45:30.000Z'),
      durationSec: 2730,
      exercises: [
        {
          id: 'exercise-1',
          exerciseDefinitionId: 'sys_barbell_bench_press',
          name: 'Bench Press',
          sets: [{ id: 'set-1', repsValue: '5', weightValue: '225' }],
        },
      ],
      now,
    });
    expect(store.saveDraftGraph).toHaveBeenCalledTimes(0);
  });

  it('rejects completed-session edits with end time before start time', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    await expect(
      repository.persistCompletedSessionSnapshot({
        sessionId: 'session-completed',
        gymId: 'gym-1',
        startedAt: new Date('2026-02-20T10:05:00.000Z'),
        completedAt: new Date('2026-02-20T10:00:00.000Z'),
        exercises: [],
      })
    ).rejects.toThrow('completedAt must be greater than or equal to startedAt');

    expect(store.saveCompletedSessionGraph).toHaveBeenCalledTimes(0);
  });

  it('reopens a completed session via the store contract with deterministic timestamping', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T11:00:00.000Z');

    const result = await repository.reopenCompletedSession('session-completed', { now });

    expect(result).toEqual({ sessionId: 'session-completed' });
    expect(store.reopenCompletedSession).toHaveBeenCalledWith({
      sessionId: 'session-completed',
      updatedAt: now,
    });
  });

  it('surfaces single-active-session reopen rejections from the store invariant', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.reopenCompletedSession.mockRejectedValue(
      new Error('Cannot reopen session session-completed while another active or draft session exists')
    );

    await expect(repository.reopenCompletedSession('session-completed')).rejects.toThrow(
      'Cannot reopen session session-completed while another active or draft session exists'
    );
  });

  it('completes a session with deterministic materialized duration seconds', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.loadSessionById.mockResolvedValue(
      buildSessionRecord({
        id: 'session-complete',
        status: 'active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
      })
    );

    const result = await repository.completeSession('session-complete', {
      completedAt: new Date('2026-02-20T10:05:59.000Z'),
      now: new Date('2026-02-20T10:06:00.000Z'),
    });

    expect(result).toEqual({
      sessionId: 'session-complete',
      completedAt: new Date('2026-02-20T10:05:59.000Z'),
      durationSec: 359,
      wasAlreadyCompleted: false,
    });
    expect(store.completeSession).toHaveBeenCalledWith({
      sessionId: 'session-complete',
      completedAt: new Date('2026-02-20T10:05:59.000Z'),
      durationSec: 359,
      updatedAt: new Date('2026-02-20T10:06:00.000Z'),
    });
  });

  it('is idempotent-safe when session is already completed with materialized values', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.loadSessionById.mockResolvedValue(
      buildSessionRecord({
        id: 'session-done',
        status: 'completed',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
        completedAt: new Date('2026-02-20T10:05:00.000Z'),
        durationSec: 300,
      })
    );

    const result = await repository.completeSession('session-done', {
      completedAt: new Date('2026-02-20T10:06:00.000Z'),
    });

    expect(result).toEqual({
      sessionId: 'session-done',
      completedAt: new Date('2026-02-20T10:05:00.000Z'),
      durationSec: 300,
      wasAlreadyCompleted: true,
    });
    expect(store.completeSession).toHaveBeenCalledTimes(0);
  });

  it('supports completed-session filtering and sorting by duration/completedAt', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.listCompletedSessions.mockResolvedValue([
      buildSessionRecord({
        id: 'session-a',
        status: 'completed',
        completedAt: new Date('2026-02-20T10:30:00.000Z'),
        durationSec: 1800,
      }),
      buildSessionRecord({
        id: 'session-b',
        status: 'completed',
        completedAt: new Date('2026-02-20T11:00:00.000Z'),
        durationSec: 2400,
      }),
      buildSessionRecord({
        id: 'session-c',
        status: 'completed',
        completedAt: new Date('2026-02-20T11:15:00.000Z'),
        durationSec: 900,
      }),
      buildSessionRecord({
        id: 'session-invalid',
        status: 'completed',
        completedAt: null,
        durationSec: null,
      }),
    ]);

    const byDuration = await repository.listCompletedSessionsForAnalysis({
      minDurationSec: 1_000,
      sortBy: 'durationSec',
      sortDirection: 'asc',
    });

    expect(byDuration.map((session) => session.sessionId)).toEqual(['session-a', 'session-b']);

    const byCompletedAt = await repository.listCompletedSessionsForAnalysis({
      completedAfter: new Date('2026-02-20T10:40:00.000Z'),
      sortBy: 'completedAt',
      sortDirection: 'desc',
      limit: 1,
    });

    expect(byCompletedAt).toEqual([
      expect.objectContaining({
        sessionId: 'session-c',
        durationSec: 900,
      }),
    ]);
  });
});

describe('calculateSessionDurationSec', () => {
  it('clamps negative durations to zero for timing guard behavior', () => {
    const durationSec = calculateSessionDurationSec(
      new Date('2026-02-20T10:05:00.000Z'),
      new Date('2026-02-20T10:00:00.000Z')
    );

    expect(durationSec).toBe(0);
  });
});
