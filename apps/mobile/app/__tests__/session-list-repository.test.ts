import {
  countConfirmedSessionSets,
  createSessionListRepository,
  type SessionListStore,
  type SessionListStoreRecord,
} from '@/src/data/session-list';

const createMockStore = (): jest.Mocked<SessionListStore> => ({
  listSessionRecords: jest.fn(),
  setSessionDeletedState: jest.fn(),
});

const buildRecord = (overrides: Partial<SessionListStoreRecord> = {}): SessionListStoreRecord => ({
  id: 'session-1',
  status: 'completed',
  startedAt: new Date('2026-02-20T10:00:00.000Z'),
  completedAt: new Date('2026-02-20T10:45:00.000Z'),
  durationSec: 2700,
  createdAt: new Date('2026-02-20T10:00:00.000Z'),
  updatedAt: new Date('2026-02-20T10:50:00.000Z'),
  deletedAt: null,
  gymName: 'Westside',
  exerciseCount: 3,
  setCount: 12,
  ...overrides,
});

describe('session list repository', () => {
  it('counts only valid explicitly confirmed sets in list summaries', () => {
    const counts = countConfirmedSessionSets(
      [
        {
          sessionExerciseId: 'se-1',
          repsValue: '5',
          weightValue: '100',
          performanceStatus: null,
        },
        {
          sessionExerciseId: 'se-1',
          repsValue: '10',
          weightValue: '500',
          performanceStatus: 'unperformed',
        },
        {
          sessionExerciseId: 'se-1',
          repsValue: '',
          weightValue: '100',
          performanceStatus: null,
        },
      ],
      new Map([['se-1', 'session-1']])
    );

    expect(counts.get('session-1')).toBe(1);
  });

  it('surfaces the most recent active session and orders completed sessions by completedAt desc', async () => {
    const store = createMockStore();
    const repository = createSessionListRepository(store);

    store.listSessionRecords.mockResolvedValue([
      buildRecord({
        id: 'active-older',
        status: 'active',
        completedAt: null,
        durationSec: null,
        updatedAt: new Date('2026-02-20T11:00:00.000Z'),
      }),
      buildRecord({
        id: 'active-newer',
        status: 'active',
        completedAt: null,
        durationSec: null,
        updatedAt: new Date('2026-02-20T11:15:00.000Z'),
        gymName: null,
        exerciseCount: 1,
        setCount: 4,
      }),
      buildRecord({
        id: 'completed-b',
        status: 'completed',
        completedAt: new Date('2026-02-20T12:00:00.000Z'),
        durationSec: 3900,
      }),
      buildRecord({
        id: 'completed-a',
        status: 'completed',
        completedAt: new Date('2026-02-20T13:00:00.000Z'),
        durationSec: 1800,
      }),
      buildRecord({
        id: 'completed-missing-completed-at',
        status: 'completed',
        completedAt: null,
      }),
    ]);

    const result = await repository.listBuckets();

    expect(result.active).toEqual(
      expect.objectContaining({
        id: 'active-newer',
        status: 'active',
        compactDuration: '0m',
        gymName: null,
        exerciseCount: 1,
        setCount: 4,
      })
    );

    expect(result.completed.map((session) => session.id)).toEqual(['completed-a', 'completed-b']);
    expect(result.completed[0]).toEqual(
      expect.objectContaining({
        compactDuration: '30m',
        gymName: 'Westside',
        exerciseCount: 3,
        setCount: 12,
      })
    );
    expect(result.completed[1].compactDuration).toBe('1h 5m');
  });

  it('excludes soft-deleted sessions by default and includes deleted completed sessions only when requested', async () => {
    const store = createMockStore();
    const repository = createSessionListRepository(store);

    store.listSessionRecords.mockResolvedValue([
      buildRecord({
        id: 'active-deleted',
        status: 'active',
        completedAt: null,
        durationSec: null,
        deletedAt: new Date('2026-02-20T12:00:00.000Z'),
      }),
      buildRecord({
        id: 'completed-visible',
        status: 'completed',
      }),
      buildRecord({
        id: 'completed-deleted',
        status: 'completed',
        deletedAt: new Date('2026-02-20T12:05:00.000Z'),
        completedAt: new Date('2026-02-20T11:59:00.000Z'),
      }),
    ]);

    const hiddenDeleted = await repository.listBuckets();
    expect(hiddenDeleted.active).toBeNull();
    expect(hiddenDeleted.completed.map((session) => session.id)).toEqual(['completed-visible']);

    const withDeleted = await repository.listBuckets({ includeDeleted: true });
    expect(withDeleted.active).toBeNull();
    expect(withDeleted.completed.map((session) => session.id)).toEqual(['completed-deleted', 'completed-visible']);
    expect(withDeleted.completed[0].deletedAt).toEqual(new Date('2026-02-20T12:05:00.000Z'));
  });

  it('writes soft-delete state changes with deterministic timestamps', async () => {
    const store = createMockStore();
    const repository = createSessionListRepository(store);
    const now = new Date('2026-02-23T12:34:56.000Z');

    await repository.setDeletedState('session-a', true, { now });
    await repository.setDeletedState('session-a', false, { now });

    expect(store.setSessionDeletedState).toHaveBeenNthCalledWith(1, {
      sessionId: 'session-a',
      deletedAt: now,
      updatedAt: now,
    });
    expect(store.setSessionDeletedState).toHaveBeenNthCalledWith(2, {
      sessionId: 'session-a',
      deletedAt: null,
      updatedAt: now,
    });
  });
});
