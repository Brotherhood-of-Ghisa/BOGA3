/**
 * The first-sync progress snapshot seam: a denominator-free shape (phase + two
 * monotonic counters + an offline flag) that the bootstrapper writes and the
 * status surface reads. These tests pin the shape and the read/write/reset
 * contract so the producer and the surfacing layer agree on it.
 */

import {
  getSyncProgress,
  INITIAL_SYNC_PROGRESS,
  PULL_LAYER_COUNT,
  resetSyncProgress,
  setSyncProgress,
  type SyncProgress,
} from '@/src/sync/progress';

afterEach(() => {
  resetSyncProgress();
});

describe('sync progress snapshot seam', () => {
  it('starts from an idle, zero-counter, online snapshot', () => {
    resetSyncProgress();
    expect(getSyncProgress()).toEqual(INITIAL_SYNC_PROGRESS);
    expect(getSyncProgress()).toMatchObject({
      phase: 'idle',
      layersCompleted: 0,
      rowsApplied: 0,
      offline: false,
    });
  });

  it('exposes the fixed four-layer denominator', () => {
    expect(PULL_LAYER_COUNT).toBe(4);
  });

  it('returns the latest snapshot a producer publishes', () => {
    const published: SyncProgress = {
      phase: 'pull',
      layersCompleted: 2,
      rowsApplied: 137,
      offline: false,
    };
    setSyncProgress(published);
    expect(getSyncProgress()).toEqual(published);
  });

  it('resets back to idle on demand so a fresh run starts honest', () => {
    setSyncProgress({ phase: 'seed', layersCompleted: 4, rowsApplied: 9, offline: false });
    resetSyncProgress();
    expect(getSyncProgress()).toEqual(INITIAL_SYNC_PROGRESS);
  });

  it('carries the offline flag through unchanged for the surfacing layer to override', () => {
    setSyncProgress({ phase: 'pull', layersCompleted: 1, rowsApplied: 4, offline: true });
    expect(getSyncProgress().offline).toBe(true);
  });
});
