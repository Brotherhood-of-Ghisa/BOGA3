import {
  createSessionEntryCoordinator,
  type SessionEntryDependencies,
} from '@/src/session-entry';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const dependencies = (): jest.Mocked<SessionEntryDependencies> => ({
  reopenCompletedSession: jest.fn().mockImplementation(async (sessionId) => ({ sessionId })),
  loadActiveSessionId: jest.fn().mockResolvedValue(null),
  createEmptySession: jest.fn().mockResolvedValue({ sessionId: 'new-session' }),
});

describe('session-entry coordinator', () => {
  it('waits for Start before checking a Resume target and surfaces its own conflict', async () => {
    const deps = dependencies();
    const create = deferred<{ sessionId: string }>();
    deps.createEmptySession.mockReturnValue(create.promise);
    deps.reopenCompletedSession.mockRejectedValue(new Error('another workout is active'));
    const coordinator = createSessionEntryCoordinator(deps);
    const started = coordinator.startEmptyOrResume();
    const resumed = coordinator.resumeCompletedSession('finished');
    expect(deps.reopenCompletedSession).not.toHaveBeenCalled();
    create.resolve({ sessionId: 'new-session' });
    await expect(started).resolves.toMatchObject({ sessionId: 'new-session' });
    await expect(resumed).rejects.toThrow('another workout is active');
    expect(deps.reopenCompletedSession).toHaveBeenCalledWith('finished');
  });

  it('opens the resumed workout when Start arrives during Resume instead of creating a new one', async () => {
    const deps = dependencies();
    const reopen = deferred<{ sessionId: string }>();
    deps.reopenCompletedSession.mockReturnValue(reopen.promise);
    const coordinator = createSessionEntryCoordinator(deps);
    const resumed = coordinator.resumeCompletedSession('finished');
    const started = coordinator.startEmptyOrResume();
    reopen.resolve({ sessionId: 'finished' });
    await expect(Promise.all([resumed, started])).resolves.toEqual([
      { kind: 'resumed', sessionId: 'finished' }, { kind: 'resumed', sessionId: 'finished' },
    ]);
    expect(deps.createEmptySession).not.toHaveBeenCalled();
  });

  it('releases a failed Resume so a later Start can succeed', async () => {
    const deps = dependencies();
    deps.reopenCompletedSession.mockRejectedValue(new Error('write failed'));
    const coordinator = createSessionEntryCoordinator(deps);
    await expect(coordinator.resumeCompletedSession('finished')).rejects.toThrow('write failed');
    await expect(coordinator.startEmptyOrResume()).resolves.toMatchObject({ kind: 'started' });
  });
  it('resumes the current draft instead of creating another one', async () => {
    const deps = dependencies();
    deps.loadActiveSessionId.mockResolvedValue('active-session');
    const coordinator = createSessionEntryCoordinator(deps);

    await expect(coordinator.startEmptyOrResume()).resolves.toEqual({
      kind: 'resumed',
      sessionId: 'active-session',
    });
    expect(deps.createEmptySession).not.toHaveBeenCalled();
  });

  it('serializes simultaneous empty-session requests', async () => {
    const deps = dependencies();
    const create = deferred<{ sessionId: string }>();
    deps.createEmptySession.mockReturnValue(create.promise);
    const coordinator = createSessionEntryCoordinator(deps);

    const first = coordinator.startEmptyOrResume();
    const second = coordinator.startEmptyOrResume();
    expect(first).toBe(second);
    expect(deps.loadActiveSessionId).toHaveBeenCalledTimes(1);

    create.resolve({ sessionId: 'one-session' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'started', sessionId: 'one-session' },
      { kind: 'started', sessionId: 'one-session' },
    ]);
    expect(deps.createEmptySession).toHaveBeenCalledTimes(1);
  });

  it('shares the same lock across empty and planned launches', async () => {
    const deps = dependencies();
    const create = deferred<{ sessionId: string }>();
    deps.createEmptySession.mockReturnValue(create.promise);
    const materialize = jest.fn().mockResolvedValue({ sessionId: 'planned-session' });
    const coordinator = createSessionEntryCoordinator(deps);

    const emptyLaunch = coordinator.startEmptyOrResume();
    const plannedLaunch = coordinator.startPlannedOrResume(materialize);
    create.resolve({ sessionId: 'empty-session' });

    await expect(Promise.all([emptyLaunch, plannedLaunch])).resolves.toEqual([
      { kind: 'started', sessionId: 'empty-session' },
      { kind: 'started', sessionId: 'empty-session' },
    ]);
    expect(materialize).not.toHaveBeenCalled();
  });

  it('releases the lock after failure so retry can succeed', async () => {
    const deps = dependencies();
    deps.createEmptySession
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ sessionId: 'retry-session' });
    const coordinator = createSessionEntryCoordinator(deps);

    await expect(coordinator.startEmptyOrResume()).rejects.toThrow('write failed');
    await expect(coordinator.startEmptyOrResume()).resolves.toEqual({
      kind: 'started',
      sessionId: 'retry-session',
    });
    expect(deps.loadActiveSessionId).toHaveBeenCalledTimes(2);
    expect(deps.createEmptySession).toHaveBeenCalledTimes(2);
  });

  it('materializes a plan only after confirming there is no active draft', async () => {
    const deps = dependencies();
    const materialize = jest.fn().mockResolvedValue({ sessionId: 'planned-session' });
    const coordinator = createSessionEntryCoordinator(deps);

    await expect(coordinator.startPlannedOrResume(materialize)).resolves.toEqual({
      kind: 'started',
      sessionId: 'planned-session',
    });
    expect(deps.loadActiveSessionId).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
  });
});
