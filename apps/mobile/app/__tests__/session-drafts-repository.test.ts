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
          exerciseDefinitionId: 'seed_barbell_bench_press',
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
        exercises: [expect.objectContaining({ exerciseDefinitionId: 'seed_barbell_bench_press' })],
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
          exerciseDefinitionId: 'seed_barbell_bench_press',
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
            exerciseDefinitionId: 'seed_barbell_bench_press',
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
          exerciseDefinitionId: 'seed_barbell_bench_press',
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
          exerciseDefinitionId: 'seed_incline_dumbbell_press',
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
            exerciseDefinitionId: 'seed_barbell_bench_press',
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
          exerciseDefinitionId: 'seed_barbell_bench_press',
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

  it('appends a completed session into an active draft as planned target rows', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T12:00:00.000Z');

    store.loadSessionGraphById.mockResolvedValue({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'completed',
        gymId: 'gym-history',
        completedAt: new Date('2026-02-19T11:00:00.000Z'),
        durationSec: 3600,
      }),
      exercises: [
        {
          id: 'source-exercise-1',
          sessionId: 'session-source',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'source-set-1',
              sessionExerciseId: 'source-exercise-1',
              orderIndex: 0,
              repsValue: '6',
              weightValue: '',
              setType: null,
            },
          ],
        },
      ],
    });
    store.loadLatestDraftGraph.mockResolvedValue({
      session: buildSessionRecord({
        id: 'active-session',
        status: 'active',
        gymId: 'gym-active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
      }),
      exercises: [],
    });
    store.saveDraftGraph.mockResolvedValue({ sessionId: 'active-session' });

    const result = await repository.appendCompletedSessionAsPlanned('session-source', { now });

    expect(result).toEqual({ sessionId: 'active-session' });
    expect(store.saveDraftGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'active-session',
        gymId: 'gym-active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
        exercises: [
          expect.objectContaining({
            exerciseDefinitionId: 'seed_pull_up',
            name: 'Pull-ups',
            sets: [
              expect.objectContaining({
                repsValue: '',
                weightValue: '',
                setType: null,
                plannedRepsValue: '6',
                plannedWeightValue: '',
                plannedSetType: null,
                performanceStatus: 'planned',
              }),
            ],
          }),
        ],
        now,
      })
    );
  });

  it('appends only the selected completed-session exercise block as planned target rows', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T12:00:00.000Z');

    store.loadSessionGraphById.mockResolvedValue({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'completed',
        gymId: 'gym-history',
        completedAt: new Date('2026-02-19T11:00:00.000Z'),
        durationSec: 3600,
      }),
      exercises: [
        {
          id: 'source-exercise-1',
          sessionId: 'session-source',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'source-set-1',
              sessionExerciseId: 'source-exercise-1',
              orderIndex: 0,
              repsValue: '6',
              weightValue: '',
              setType: null,
            },
          ],
        },
        {
          id: 'source-exercise-2',
          sessionId: 'session-source',
          exerciseDefinitionId: 'seed_dumbbell_row',
          orderIndex: 1,
          name: 'DB Row',
          machineName: null,
          sets: [
            {
              id: 'source-set-2',
              sessionExerciseId: 'source-exercise-2',
              orderIndex: 0,
              repsValue: '8',
              weightValue: '30',
              setType: 'rir_1',
            },
          ],
        },
      ],
    });
    store.loadLatestDraftGraph.mockResolvedValue(null);
    store.saveDraftGraph.mockResolvedValue({ sessionId: 'new-active-session' });

    const result = await repository.appendCompletedSessionExerciseAsPlanned(
      'session-source',
      'source-exercise-2',
      { now }
    );

    expect(result).toEqual({ sessionId: 'new-active-session' });
    const saveInput = store.saveDraftGraph.mock.calls[0]?.[0];
    expect(saveInput).toEqual(
      expect.objectContaining({
        sessionId: undefined,
        gymId: 'gym-history',
        startedAt: now,
        status: 'active',
        now,
      })
    );
    expect(saveInput?.exercises).toHaveLength(1);
    expect(saveInput?.exercises[0]).toEqual(
      expect.objectContaining({
        exerciseDefinitionId: 'seed_dumbbell_row',
        name: 'DB Row',
        sets: [
          expect.objectContaining({
            repsValue: '',
            weightValue: '',
            setType: null,
            plannedRepsValue: '8',
            plannedWeightValue: '30',
            plannedSetType: 'rir_1',
            performanceStatus: 'planned',
          }),
        ],
      })
    );
  });

  it('appends block planned rows to the last active exercise when it has the same definition', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T12:00:00.000Z');

    store.loadSessionGraphById.mockResolvedValue({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'completed',
        gymId: 'gym-history',
        completedAt: new Date('2026-02-19T11:00:00.000Z'),
        durationSec: 3600,
      }),
      exercises: [
        {
          id: 'source-exercise-1',
          sessionId: 'session-source',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'source-set-1',
              sessionExerciseId: 'source-exercise-1',
              orderIndex: 0,
              repsValue: '6',
              weightValue: '',
              setType: 'rir_2',
            },
          ],
        },
      ],
    });
    store.loadLatestDraftGraph.mockResolvedValue({
      session: buildSessionRecord({
        id: 'active-session',
        status: 'active',
        gymId: 'gym-active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
      }),
      exercises: [
        {
          id: 'active-exercise-first',
          sessionId: 'active-session',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'active-set-1',
              sessionExerciseId: 'active-exercise-first',
              orderIndex: 0,
              repsValue: '5',
              weightValue: '',
              setType: null,
            },
          ],
        },
        {
          id: 'active-exercise-second',
          sessionId: 'active-session',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 1,
          name: 'Pull-ups duplicate',
          machineName: null,
          sets: [
            {
              id: 'active-set-2',
              sessionExerciseId: 'active-exercise-second',
              orderIndex: 0,
              repsValue: '4',
              weightValue: '',
              setType: null,
            },
          ],
        },
      ],
    });
    store.saveDraftGraph.mockResolvedValue({ sessionId: 'active-session' });

    await repository.appendCompletedSessionExerciseAsPlanned('session-source', 'source-exercise-1', { now });

    const saveInput = store.saveDraftGraph.mock.calls[0]?.[0];
    expect(saveInput).toEqual(
      expect.objectContaining({
        sessionId: 'active-session',
        gymId: 'gym-active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
      })
    );
    expect(saveInput?.exercises).toHaveLength(2);
    expect(saveInput?.exercises[0]?.sets).toHaveLength(1);
    expect(saveInput?.exercises[1]?.sets).toHaveLength(2);
    expect(saveInput?.exercises[1]?.sets[1]).toEqual(
      expect.objectContaining({
        repsValue: '',
        weightValue: '',
        setType: null,
        plannedRepsValue: '6',
        plannedWeightValue: '',
        plannedSetType: 'rir_2',
        performanceStatus: 'planned',
      })
    );
  });

  it('creates a new bottom exercise card when the last active exercise does not match', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);
    const now = new Date('2026-02-20T12:00:00.000Z');

    store.loadSessionGraphById.mockResolvedValue({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'completed',
        gymId: 'gym-history',
        completedAt: new Date('2026-02-19T11:00:00.000Z'),
        durationSec: 3600,
      }),
      exercises: [
        {
          id: 'source-exercise-1',
          sessionId: 'session-source',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups',
          machineName: null,
          sets: [
            {
              id: 'source-set-1',
              sessionExerciseId: 'source-exercise-1',
              orderIndex: 0,
              repsValue: '6',
              weightValue: '',
              setType: null,
            },
          ],
        },
      ],
    });
    store.loadLatestDraftGraph.mockResolvedValue({
      session: buildSessionRecord({
        id: 'active-session',
        status: 'active',
        gymId: 'gym-active',
        startedAt: new Date('2026-02-20T10:00:00.000Z'),
      }),
      exercises: [
        {
          id: 'active-exercise-1',
          sessionId: 'active-session',
          exerciseDefinitionId: 'seed_pull_up',
          orderIndex: 0,
          name: 'Pull-ups earlier',
          machineName: null,
          sets: [],
        },
        {
          id: 'active-exercise-2',
          sessionId: 'active-session',
          exerciseDefinitionId: 'seed_bench_press',
          orderIndex: 1,
          name: 'Bench Press',
          machineName: null,
          sets: [],
        },
      ],
    });
    store.saveDraftGraph.mockResolvedValue({ sessionId: 'active-session' });

    await repository.appendCompletedSessionExerciseAsPlanned('session-source', 'source-exercise-1', { now });

    const saveInput = store.saveDraftGraph.mock.calls[0]?.[0];
    expect(saveInput?.exercises).toHaveLength(3);
    expect(saveInput?.exercises[0]?.name).toBe('Pull-ups earlier');
    expect(saveInput?.exercises[1]?.name).toBe('Bench Press');
    expect(saveInput?.exercises[2]).toEqual(
      expect.objectContaining({
        exerciseDefinitionId: 'seed_pull_up',
        name: 'Pull-ups',
        sets: [
          expect.objectContaining({
            plannedRepsValue: '6',
            performanceStatus: 'planned',
          }),
        ],
      })
    );
  });

  it('rejects block append for non-completed source sessions and source exercises outside the session', async () => {
    const store = createMockStore();
    const repository = createSessionDraftRepository(store);

    store.loadSessionGraphById.mockResolvedValueOnce({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'active',
      }),
      exercises: [],
    });

    await expect(
      repository.appendCompletedSessionExerciseAsPlanned('session-source', 'source-exercise-1')
    ).rejects.toThrow('Cannot append non-completed session session-source');

    store.loadSessionGraphById.mockResolvedValueOnce({
      session: buildSessionRecord({
        id: 'session-source',
        status: 'completed',
        completedAt: new Date('2026-02-19T11:00:00.000Z'),
        durationSec: 3600,
      }),
      exercises: [],
    });

    await expect(
      repository.appendCompletedSessionExerciseAsPlanned('session-source', 'missing-exercise')
    ).rejects.toThrow('Exercise missing-exercise does not belong to session session-source');

    expect(store.saveDraftGraph).toHaveBeenCalledTimes(0);
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
