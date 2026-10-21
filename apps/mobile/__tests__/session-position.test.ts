/**
 * The session view's position cache (`src/location/session-position.ts`): the
 * recorder starts acquiring once, the sheet reads the cache and hears about
 * the fix the moment it lands, and a session with no usable fix gives up for
 * good. Injected readers stand in for the native module.
 */

import {
  beginSessionPosition,
  getSessionPosition,
  resetSessionPositions,
  SESSION_POSITION_MAX_ACCURACY_M,
  SESSION_POSITION_MAX_COARSE_READS,
  subscribeSessionPosition,
} from '@/src/location/session-position';

const fixAt = (accuracyM: number | null, latitude = 51.5, longitude = -0.12) => ({
  status: 'success' as const,
  position: { latitude, longitude, accuracyM, capturedAt: new Date('2026-09-23T10:00:00Z') },
});

const readerOf = (results: unknown[]): jest.Mock => {
  const read = jest.fn();
  results.forEach((result) => read.mockResolvedValueOnce(result));
  return read;
};

beforeEach(() => {
  resetSessionPositions();
});

describe('session position', () => {
  it("caches the session's first usable fix and reads no more", async () => {
    const read = readerOf([fixAt(20)]);
    await beginSessionPosition('session-1', read);

    expect(getSessionPosition('session-1')).toMatchObject({ latitude: 51.5, longitude: -0.12, accuracyM: 20 });

    await beginSessionPosition('session-1', readerOf([fixAt(30)]));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('tells a subscriber the moment the fix lands', async () => {
    const updates: unknown[] = [];
    const unsubscribe = subscribeSessionPosition((position) => updates.push(position));

    await beginSessionPosition('session-1', readerOf([fixAt(20)]));
    unsubscribe();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ latitude: 51.5 });
  });

  it('stops listening after unsubscribe', async () => {
    const updates: unknown[] = [];
    const unsubscribe = subscribeSessionPosition((position) => updates.push(position));
    unsubscribe();

    await beginSessionPosition('session-1', readerOf([fixAt(20)]));

    expect(updates).toHaveLength(0);
  });

  it('retries a fix coarser than the gate and caches the one that tightens', async () => {
    const read = readerOf([fixAt(SESSION_POSITION_MAX_ACCURACY_M + 1), fixAt(30)]);
    await beginSessionPosition('session-1', read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(getSessionPosition('session-1')?.accuracyM).toBe(30);
  });

  it('gives up after the retry budget of coarse reads and does not read again', async () => {
    const read = readerOf([fixAt(600), fixAt(550), fixAt(501)]);
    await beginSessionPosition('session-1', read);

    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_COARSE_READS);
    expect(getSessionPosition('session-1')).toBeNull();

    await beginSessionPosition('session-1', readerOf([fixAt(20)]));
    expect(read).toHaveBeenCalledTimes(SESSION_POSITION_MAX_COARSE_READS);
  });

  it('gives up on a denied permission, services off or a failed read, without throwing', async () => {
    await beginSessionPosition('session-1', readerOf([{ status: 'permission_denied', canAskAgain: false }]));
    await beginSessionPosition('session-2', readerOf([{ status: 'unavailable', reason: 'services_disabled' }]));
    await beginSessionPosition('session-3', readerOf([{ status: 'read_failure', error: new Error('gps') }]));

    expect(getSessionPosition('session-1')).toBeNull();
    expect(getSessionPosition('session-2')).toBeNull();
    expect(getSessionPosition('session-3')).toBeNull();
  });

  it('treats a rejected read as no fix rather than a crash', async () => {
    const read = jest.fn().mockRejectedValue(new Error('native'));
    await expect(beginSessionPosition('session-1', read)).resolves.toBeUndefined();

    expect(getSessionPosition('session-1')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps sessions apart: one session's fix is another's absence", async () => {
    await beginSessionPosition('session-1', readerOf([fixAt(20)]));

    expect(getSessionPosition('session-2')).toBeNull();

    await beginSessionPosition('session-2', readerOf([fixAt(40, 48.85, 2.35)]));
    expect(getSessionPosition('session-1')?.accuracyM).toBe(20);
    expect(getSessionPosition('session-2')?.latitude).toBe(48.85);
  });
});
