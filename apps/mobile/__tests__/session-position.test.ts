/**
 * The session view's position cache (`src/location/session-position.ts`): the
 * recorder starts acquiring when the session opens, the sheet reads the cache
 * and hears about the first fix the moment it lands — any fix, however
 * coarse — then about each more accurate one until a fix is good; timed-out
 * or failed reads retry after a wait, and only permission denials and services-off end the
 * acquisition for good. Injected readers stand in for the native module.
 */

import {
  beginSessionPosition,
  getSessionPosition,
  getSessionPositionState,
  resetSessionPositions,
  SESSION_POSITION_GOOD_ACCURACY_M,
  SESSION_POSITION_MAX_READS,
  subscribeSessionPosition,
  subscribeSessionPositionState,
} from '@/src/location/session-position';

const fixAt = (accuracyM: number | null, latitude = 51.5, longitude = -0.12) => ({
  status: 'success' as const,
  position: { latitude, longitude, accuracyM, capturedAt: new Date('2026-09-23T10:00:00Z') },
});

const TIMEOUT = { status: 'timeout' as const, timeoutMs: 10_000 };

const readerOf = (results: unknown[]): jest.Mock => {
  const read = jest.fn();
  results.forEach((result) => read.mockResolvedValueOnce(result));
  return read;
};

beforeEach(() => {
  resetSessionPositions();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('session position', () => {
  it("caches the session's first good fix and reads no more", async () => {
    const read = readerOf([fixAt(20)]);
    await beginSessionPosition('session-1', {}, read, 0);

    expect(getSessionPosition('session-1')).toMatchObject({ latitude: 51.5, longitude: -0.12, accuracyM: 20 });

    await beginSessionPosition('session-1', {}, readerOf([fixAt(30)]), 0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('tells a subscriber the moment the fix lands', async () => {
    const updates: unknown[] = [];
    const unsubscribe = subscribeSessionPosition('session-1', (position) => updates.push(position));

    await beginSessionPosition('session-1', {}, readerOf([fixAt(20)]), 0);
    unsubscribe();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ latitude: 51.5 });
  });

  it('stops listening after unsubscribe', async () => {
    const updates: unknown[] = [];
    const unsubscribe = subscribeSessionPosition('session-1', (position) => updates.push(position));
    unsubscribe();

    await beginSessionPosition('session-1', {}, readerOf([fixAt(20)]), 0);

    expect(updates).toHaveLength(0);
  });

  it('publishes a coarse fix at once and keeps reading until a good one', async () => {
    const updates: (number | null)[] = [];
    subscribeSessionPosition('session-1', (position) => updates.push(position.accuracyM));
    const states: unknown[] = [];
    subscribeSessionPositionState('session-1', (state) => states.push({ ...state }));
    const read = readerOf([fixAt(3_000), fixAt(400), fixAt(SESSION_POSITION_GOOD_ACCURACY_M), fixAt(5)]);

    await beginSessionPosition('session-1', {}, read, 0);

    expect(read).toHaveBeenCalledTimes(3);
    expect(updates).toEqual([3_000, 400, SESSION_POSITION_GOOD_ACCURACY_M]);
    // The coarse fix is readable while reading goes on.
    expect(states[1]).toMatchObject({ status: 'reading', position: { accuracyM: 3_000 } });
    expect(getSessionPositionState('session-1')).toMatchObject({
      status: 'available',
      position: { accuracyM: SESSION_POSITION_GOOD_ACCURACY_M },
    });
  });

  it('keeps the most accurate fix: a looser or unknown-accuracy read never replaces it', async () => {
    const updates: (number | null)[] = [];
    subscribeSessionPosition('session-1', (position) => updates.push(position.accuracyM));
    const read = readerOf([fixAt(null), fixAt(300), fixAt(900), fixAt(null), { status: 'timeout', timeoutMs: 1 }, fixAt(50)]);

    await beginSessionPosition('session-1', {}, read, 0);

    expect(updates).toEqual([null, 300, 50]);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(50);
  });

  it('settles on its best coarse fix when the budget runs out, and the sheet can resume refining it', async () => {
    const read = readerOf(Array.from({ length: SESSION_POSITION_MAX_READS }, () => fixAt(300)));
    await beginSessionPosition('session-1', {}, read, 0);

    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_READS);
    expect(getSessionPositionState('session-1')).toMatchObject({
      status: 'available',
      position: { accuracyM: 300 },
      gaveUpReason: null,
    });

    const notResumed = readerOf([fixAt(40)]);
    await beginSessionPosition('session-1', {}, notResumed, 0);
    expect(notResumed).not.toHaveBeenCalled();

    // While the resumed read is in flight the coarse fix stays readable.
    let finishRead: (value: unknown) => void = () => undefined;
    const resumed = jest.fn(() => new Promise((resolve) => (finishRead = resolve)));
    const resuming = beginSessionPosition('session-1', { resume: true }, resumed as never, 0);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(300);
    finishRead(fixAt(40));
    await resuming;
    expect(getSessionPosition('session-1')?.accuracyM).toBe(40);

    const afterGood = readerOf([fixAt(5)]);
    await beginSessionPosition('session-1', { resume: true }, afterGood, 0);
    expect(afterGood).not.toHaveBeenCalled();
  });

  it('keeps a coarse fix when a later read is denied, and does not resume', async () => {
    await beginSessionPosition(
      'session-1',
      {},
      readerOf([fixAt(300), { status: 'permission_denied', canAskAgain: false }]),
      0
    );

    expect(getSessionPositionState('session-1')).toMatchObject({ status: 'available', position: { accuracyM: 300 } });
    const resumed = readerOf([fixAt(40)]);
    await beginSessionPosition('session-1', { resume: true }, resumed, 0);
    expect(resumed).not.toHaveBeenCalled();
  });

  it('gives up after the read budget of timed-out reads and does not read again', async () => {
    const read = readerOf(Array.from({ length: SESSION_POSITION_MAX_READS }, () => TIMEOUT));
    await beginSessionPosition('session-1', {}, read, 0);

    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_READS);
    expect(getSessionPosition('session-1')).toBeNull();
    expect(getSessionPositionState('session-1')).toMatchObject({ status: 'unavailable', gaveUpReason: 'no_fix' });

    await beginSessionPosition('session-1', {}, readerOf([fixAt(20)]), 0);
    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_READS);
  });

  it('lets the gym sheet resume a spent acquisition, but not a denial', async () => {
    const read = readerOf(Array.from({ length: SESSION_POSITION_MAX_READS }, () => TIMEOUT));
    await beginSessionPosition('session-1', {}, read, 0);

    const resumed = readerOf([fixAt(25)]);
    await beginSessionPosition('session-1', { resume: true }, resumed, 0);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(25);

    await beginSessionPosition('session-2', {}, readerOf([{ status: 'permission_denied', canAskAgain: false }]), 0);
    const denied = readerOf([fixAt(25)]);
    await beginSessionPosition('session-2', { resume: true }, denied, 0);
    expect(denied).not.toHaveBeenCalled();
    expect(getSessionPosition('session-2')).toBeNull();
  });

  it('stops retrying once the wall-clock budget is spent, even with reads left', async () => {
    // Each read advances the fake clock 15 s, so the budget (60 s) runs out
    // before the read count (6) does.
    const read = jest.fn(async () => {
      jest.advanceTimersByTime(15_000);
      return TIMEOUT;
    });
    jest.setSystemTime(0);
    const acquisition = beginSessionPosition('session-1', {}, read, 5_000);
    await jest.runAllTimersAsync();
    await acquisition;

    expect(read).toHaveBeenCalledTimes(3);
    expect(getSessionPositionState('session-1')).toMatchObject({ status: 'unavailable' });
  });

  it('gives up at once on a denied permission or services off, without throwing', async () => {
    const denied = readerOf([{ status: 'permission_denied', canAskAgain: false }]);
    await beginSessionPosition('session-1', {}, denied, 0);
    const servicesOff = readerOf([{ status: 'unavailable', reason: 'services_disabled' }]);
    await beginSessionPosition('session-2', {}, servicesOff, 0);

    expect(denied).toHaveBeenCalledTimes(1);
    expect(servicesOff).toHaveBeenCalledTimes(1);
    expect(getSessionPositionState('session-1')).toMatchObject({ status: 'unavailable', gaveUpReason: 'permission_denied' });
    expect(getSessionPositionState('session-2')).toMatchObject({ status: 'unavailable', gaveUpReason: 'services_disabled' });
  });

  it('waits between retries and reports each read in the diagnostics state', async () => {
    const read = readerOf([{ status: 'timeout', timeoutMs: 10_000 }, fixAt(60)]);
    const states: unknown[] = [];
    subscribeSessionPositionState('session-1', (state) => states.push({ ...state }));

    const acquisition = beginSessionPosition('session-1', {}, read, 2_000);
    await jest.runAllTimersAsync();
    await acquisition;

    expect(read).toHaveBeenCalledTimes(2);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(60);
    const finalState = getSessionPositionState('session-1');
    expect(finalState).toMatchObject({
      status: 'available',
      attempts: 2,
      lastRead: { status: 'success', accuracyM: 60 },
      gaveUpReason: null,
    });
    // Every state change lands in order: reading, after the timeout, then the fix.
    expect(states).toHaveLength(4);
    expect(states[0]).toMatchObject({ status: 'reading' });
    expect(states[1]).toMatchObject({ status: 'reading', attempts: 1, lastRead: { status: 'timeout' } });
    expect(states[3]).toMatchObject({ status: 'available', attempts: 2 });
  });

  it('treats a rejected read as no fix rather than a crash, retrying it like a timeout', async () => {
    const read = jest.fn().mockRejectedValue(new Error('native'));
    await expect(beginSessionPosition('session-1', {}, read, 0)).resolves.toBeUndefined();

    expect(getSessionPosition('session-1')).toBeNull();
    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_READS);
    expect(getSessionPositionState('session-1')).toMatchObject({ status: 'unavailable', gaveUpReason: 'read_error' });
  });

  it("keeps sessions apart: one session's fix is another's absence", async () => {
    await beginSessionPosition('session-1', {}, readerOf([fixAt(20)]), 0);

    expect(getSessionPosition('session-2')).toBeNull();

    await beginSessionPosition('session-2', {}, readerOf([fixAt(40, 48.85, 2.35)]), 0);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(20);
    expect(getSessionPosition('session-2')?.latitude).toBe(48.85);
  });

  it('delivers fixes and state only to the session that earned them', async () => {
    const sessionOnePositions: unknown[] = [];
    const sessionOneStates: unknown[] = [];
    const sessionTwoPositions: unknown[] = [];
    const sessionTwoStates: unknown[] = [];
    const unsubscribeOnePosition = subscribeSessionPosition('session-1', (position) => sessionOnePositions.push(position));
    const unsubscribeOneState = subscribeSessionPositionState('session-1', (state) => sessionOneStates.push(state));
    subscribeSessionPosition('session-2', (position) => sessionTwoPositions.push(position));
    subscribeSessionPositionState('session-2', (state) => sessionTwoStates.push(state));

    await beginSessionPosition('session-1', {}, readerOf([fixAt(20)]), 0);

    expect(sessionOnePositions).toHaveLength(1);
    expect(sessionOneStates.length).toBeGreaterThan(0);
    expect(sessionTwoPositions).toHaveLength(0);
    expect(sessionTwoStates).toHaveLength(0);

    unsubscribeOnePosition();
    unsubscribeOneState();
    await beginSessionPosition('session-2', {}, readerOf([fixAt(40, 48.85, 2.35)]), 0);

    expect(sessionOnePositions).toHaveLength(1);
    expect(sessionTwoPositions).toHaveLength(1);
  });
});
