import * as accountPreferences from '@/src/preferences/account-local';
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
  enterExercise: jest.fn(),
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


describe('exercise entry coordination', () => {
  it('coalesces duplicate taps through the complete exercise write', async () => {
    const deps = dependencies();
    const save = deferred<{ kind: 'started'; sessionId: string; sessionExerciseId: string; setId: string }>();
    deps.enterExercise.mockReturnValue(save.promise);
    const coordinator = createSessionEntryCoordinator(deps);
    const input = { exerciseDefinitionId: 'squat', mode: 'empty' as const };
    const first = coordinator.startFromExercise(input);
    const second = coordinator.startFromExercise(input);
    expect(second).toBe(first);
    save.resolve({ kind: 'started', sessionId: 's', sessionExerciseId: 'e', setId: 'set' });
    await first;
    expect(deps.enterExercise).toHaveBeenCalledTimes(1);
  });

  it('waits for Start and then adds the requested exercise to that workout', async () => {
    const deps = dependencies();
    const create = deferred<{ sessionId: string }>();
    deps.createEmptySession.mockReturnValue(create.promise);
    deps.loadActiveSessionId.mockResolvedValueOnce(null).mockResolvedValue('started');
    deps.enterExercise.mockResolvedValue({ kind: 'resumed', sessionId: 'started', sessionExerciseId: 'e', setId: 'set' });
    const coordinator = createSessionEntryCoordinator(deps);
    const start = coordinator.startEmptyOrResume();
    const add = coordinator.startFromExercise({ exerciseDefinitionId: 'squat', mode: 'empty' });
    create.resolve({ sessionId: 'started' });
    await start;
    await add;
    expect(deps.enterExercise).toHaveBeenCalledWith({ exerciseDefinitionId: 'squat', mode: 'empty' }, 'started');
  });

  it('releases a failed exercise request and still processes a different exercise', async () => {
    const deps = dependencies();
    deps.enterExercise.mockRejectedValueOnce(new Error('disk')).mockResolvedValue({ kind: 'started', sessionId: 's', sessionExerciseId: 'e', setId: 'set' });
    const coordinator = createSessionEntryCoordinator(deps);
    const first = coordinator.startFromExercise({ exerciseDefinitionId: 'squat', mode: 'empty' });
    const next = coordinator.startFromExercise({ exerciseDefinitionId: 'press', mode: 'repeat' });
    await expect(first).rejects.toThrow('disk');
    await expect(next).resolves.toMatchObject({ sessionId: 's' });
    await coordinator.startFromExercise({ exerciseDefinitionId: 'squat', mode: 'empty' });
    expect(deps.enterExercise).toHaveBeenCalledTimes(3);
  });
});


it('rejects a queued exercise when the account changes before its active-session read finishes', async () => {
  const deps = dependencies();
  const read = deferred<string | null>();
  deps.loadActiveSessionId.mockReturnValue(read.promise);
  const revision = jest.spyOn(accountPreferences, 'getAccountLocalPreferenceAccountRevision').mockReturnValue(1);
  const coordinator = createSessionEntryCoordinator(deps);
  const add = coordinator.startFromExercise({ exerciseDefinitionId: 'squat', mode: 'empty' });
  revision.mockReturnValue(2);
  read.resolve(null);
  await expect(add).rejects.toThrow('account changed');
  expect(deps.enterExercise).not.toHaveBeenCalled();
  revision.mockRestore();
});
