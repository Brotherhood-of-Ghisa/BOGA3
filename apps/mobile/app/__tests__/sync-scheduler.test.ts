import {
  createSyncScheduler,
  SYNC_GENERAL_CADENCE_MS,
  SYNC_SESSION_RECORDER_CADENCE_MS,
  syncCadenceContextFromPathname,
} from '@/src/sync';

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('sync scheduler cadence + context', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses 60s cadence in general context', async () => {
    const flush = jest.fn(async () => ({ status: 'idle' as const }));
    const scheduler = createSyncScheduler({ flush });

    scheduler.start();

    jest.advanceTimersByTime(SYNC_GENERAL_CADENCE_MS - 1);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('switches to 10s cadence when context is session-recorder', async () => {
    const flush = jest.fn(async () => ({ status: 'idle' as const }));
    const scheduler = createSyncScheduler({ flush });

    scheduler.start();
    scheduler.setContext('session-recorder');

    jest.advanceTimersByTime(SYNC_SESSION_RECORDER_CADENCE_MS - 1);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('triggers immediate flush on offline->online transition', async () => {
    const flush = jest.fn(async () => ({ status: 'idle' as const }));
    const scheduler = createSyncScheduler({ flush });

    scheduler.start();
    scheduler.setOnline(false);
    scheduler.setOnline(true);
    await flushAsync();

    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('maps route context to cadence mode', () => {
    expect(syncCadenceContextFromPathname('/session-recorder')).toBe('session-recorder');
    expect(syncCadenceContextFromPathname('/session-recorder?mode=completed-edit')).toBe('session-recorder');
    expect(syncCadenceContextFromPathname('/session-recorder#fragment')).toBe('session-recorder');
    expect(syncCadenceContextFromPathname('/session-recorder/')).toBe('session-recorder');
    expect(syncCadenceContextFromPathname('/session-recorder-legacy')).toBe('general');
    expect(syncCadenceContextFromPathname('/stats-history')).toBe('general');
    expect(syncCadenceContextFromPathname(null)).toBe('general');
  });

  it('skips the flush when bootstrap is in progress (bug 4)', async () => {
    const flush = jest.fn(async () => ({ status: 'idle' as const }));
    let bootstrapInProgress = true;
    const scheduler = createSyncScheduler({
      flush,
      isBootstrapInProgress: () => bootstrapInProgress,
    });

    scheduler.start();

    jest.advanceTimersByTime(SYNC_GENERAL_CADENCE_MS);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(0);

    bootstrapInProgress = false;
    jest.advanceTimersByTime(SYNC_GENERAL_CADENCE_MS);
    await flushAsync();
    expect(flush).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('skips the offline->online recovery flush during bootstrap (bug 4)', async () => {
    const flush = jest.fn(async () => ({ status: 'idle' as const }));
    const scheduler = createSyncScheduler({
      flush,
      isBootstrapInProgress: () => true,
    });

    scheduler.start();
    scheduler.setOnline(false);
    scheduler.setOnline(true);
    await flushAsync();

    expect(flush).toHaveBeenCalledTimes(0);

    scheduler.stop();
  });
});
