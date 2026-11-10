/**
 * One Apple Health import (`runHealthImport`) with the store and the server
 * faked: the 90-day backfill and its closing prune, anchored changes after it,
 * deletions, batching, and failures that leave the anchor where it was.
 */
import { BACKFILL_DAYS, IMPORT_BATCH_SIZE, runHealthImport, type HealthImportRun } from '@/src/health-import/importer';
import { healthImportStore } from '@/src/health-import/storage';

import { fakeHealthApi, fakeHealthStore, healthWorkout } from './helpers/health-import-fakes';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const SINCE = new Date(NOW.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);

const setup = () => {
  const store = fakeHealthStore();
  const server = fakeHealthApi();
  const run = (extra: Partial<HealthImportRun> = {}) => runHealthImport({
    userId: 'user-a', adapter: store.adapter, api: server.api, store: healthImportStore, now: NOW,
    isCurrent: () => true, ...extra,
  });
  return { store, server, run };
};

it('backfills the last 90 days the first time and closes with the complete id list', async () => {
  const { store, server, run } = setup();
  store.queue({ workouts: [healthWorkout('a'), healthWorkout('b')], deletedIds: [], newAnchor: 'anchor-1' });

  await expect(run()).resolves.toEqual({ status: 'imported', backfill: true, upserted: 2, deleted: 0, pruned: 1 });
  expect(store.reads).toEqual([{ anchor: null, since: SINCE }]);
  expect(server.calls.map((call) => [call.upserts.map((row) => row.external_id), call.completeSince ?? null])).toEqual([
    [['a', 'b'], null],
    [[], SINCE.toISOString()],
  ]);
  expect(server.calls[1].completeIds).toEqual(['a', 'b']);
  expect(healthImportStore.readAnchor('user-a')).toEqual({ anchor: 'anchor-1', since: SINCE });
});

it('reads only the changes after the saved anchor, keeping the backfill start, and never prunes again', async () => {
  const { store, server, run } = setup();
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  store.queue({ workouts: [healthWorkout('c')], deletedIds: ['a'], newAnchor: 'anchor-2' });

  await expect(run()).resolves.toMatchObject({ status: 'imported', backfill: false, upserted: 1, deleted: 1, pruned: 0 });
  expect(store.reads).toEqual([{ anchor: 'anchor-1', since: SINCE }]);
  // HealthKit deletions go first, as their own calls.
  expect(server.calls).toEqual([
    { upserts: [], deletes: ['a'] },
    { upserts: [expect.objectContaining({ external_id: 'c' })], deletes: [] },
  ]);
  expect(healthImportStore.readAnchor('user-a')?.anchor).toBe('anchor-2');
});

it('splits a large backfill into batches under the server cap', async () => {
  const { store, server, run } = setup();
  const workouts = Array.from({ length: IMPORT_BATCH_SIZE * 2 + 3 }, (_, index) => healthWorkout(`w${index}`));
  store.queue({ workouts, deletedIds: [], newAnchor: 'anchor-1' });

  await run();
  expect(server.calls.map((call) => call.upserts.length)).toEqual([IMPORT_BATCH_SIZE, IMPORT_BATCH_SIZE, 3, 0]);
  expect(server.calls[3].completeIds).toHaveLength(IMPORT_BATCH_SIZE * 2 + 3);
});

it('skips a workout that starts before the backfill window', async () => {
  const { store, server, run } = setup();
  store.queue({ workouts: [healthWorkout('old', { startDate: new Date(SINCE.getTime() - 1), endDate: SINCE })], deletedIds: [], newAnchor: 'x' });

  await run();
  expect(server.calls).toEqual([{ upserts: [], deletes: [], completeSince: SINCE.toISOString(), completeIds: [] }]);
});

it('keeps the old anchor when an upload fails, so the next import re-sends the same changes', async () => {
  const { store, server, run } = setup();
  healthImportStore.writeAnchor('user-a', 'anchor-1', SINCE);
  store.queue({ workouts: [healthWorkout('c')], deletedIds: [], newAnchor: 'anchor-2' });
  server.failNext(new Error('network'));

  await expect(run()).rejects.toThrow('network');
  expect(healthImportStore.readAnchor('user-a')?.anchor).toBe('anchor-1');

  store.queue({ workouts: [healthWorkout('c')], deletedIds: [], newAnchor: 'anchor-2' });
  await run();
  expect(store.reads.map((read) => read.anchor)).toEqual(['anchor-1', 'anchor-1']);
  expect(healthImportStore.readAnchor('user-a')?.anchor).toBe('anchor-2');
});

it('reports a store read failure as READ_FAILED and sends nothing', async () => {
  const { store, server, run } = setup();
  store.queue(new Error('HealthKit is unavailable'));

  await expect(run()).rejects.toMatchObject({ code: 'READ_FAILED', message: 'HealthKit is unavailable' });
  expect(server.calls).toEqual([]);
});

it('refuses a malformed workout instead of uploading the rest without it', async () => {
  const { store, server, run } = setup();
  store.queue({ workouts: [healthWorkout('ok'), healthWorkout('bad', { totalDistance: { quantity: 1, unit: 'league' } })], deletedIds: [], newAnchor: 'x' });

  await expect(run()).rejects.toMatchObject({ code: 'INVALID_WORKOUT' });
  expect(server.calls).toEqual([]);
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
});

it('stops writing, and saves no anchor, once the account is no longer current', async () => {
  const { store, server, run } = setup();
  const workouts = Array.from({ length: IMPORT_BATCH_SIZE + 1 }, (_, index) => healthWorkout(`w${index}`));
  store.queue({ workouts, deletedIds: [], newAnchor: 'anchor-1' });
  let current = true;
  const api = { apply: async (input: Parameters<typeof server.api.apply>[0]) => { current = false; return server.api.apply(input); } };

  await expect(run({ api, isCurrent: () => current })).resolves.toEqual({ status: 'stale' });
  expect(server.calls).toHaveLength(1);
  expect(healthImportStore.readAnchor('user-a')).toBeNull();
});

it('ignores an anchor saved for another account and backfills afresh', async () => {
  const { store, run } = setup();
  healthImportStore.writeAnchor('user-b', 'anchor-b', SINCE);

  await run();
  expect(store.reads).toEqual([{ anchor: null, since: SINCE }]);
});
