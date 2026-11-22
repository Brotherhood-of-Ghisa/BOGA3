/* eslint-disable import/first */

/**
 * Outcome: the app's Apple Health import writes through the real
 * `health_activities_apply` RPC as the signed-in owner ([[agents.health-activities]]).
 * HealthKit is faked (Jest has none); the importer, the mobile RPC client and
 * the server are real. Proves the client's argument names and result shape,
 * the backfill and its closing prune, a HealthKit deletion, and that a batch
 * the server rejects fails the import and keeps the anchor.
 *
 * Signs in as `user_e` (the lane runs its suites one at a time) and removes
 * this run's activities with the service role before and after. Runs in the
 * sync-infra lane (`./boga test sync-infra`); the faked-server versions are
 * `__tests__/health-import-*.test.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { createClientMockState } from '../helpers/sync-cycle-mocks';
import { fakeHealthStore, healthWorkout } from '../helpers/health-import-fakes';
import {
  createAuthedTestClient, createLocalServiceRoleClient, readSyncTestEndpoint, SYNC_RPC_SCHEMA, USER_E,
  type AuthedTestClient,
} from './helpers/sync-test-endpoint';

const mockClientState = createClientMockState<unknown>();
jest.mock('@/src/auth/supabase', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted factory: require resolves at call time, after the import hoist.
  (require('../helpers/sync-cycle-mocks') as typeof import('../helpers/sync-cycle-mocks')).supabaseClientMockFactory(
    () => mockClientState,
  ),
);

import { healthImportApi } from '@/src/health-import/api';
import { BACKFILL_DAYS, runHealthImport } from '@/src/health-import/importer';
import { healthImportStore } from '@/src/health-import/storage';
import { applyImportedBodyWeights } from '@/src/data/bodyweight';
import type { Transaction } from '@/src/data/clock';
import { bodyWeightMeasurements } from '@/src/data/schema';
import { applyPullPage, entityToWire, type WireEntity, type PullCursor } from '@/src/sync/cycle';
import { createInMemoryDatabase } from '../helpers/in-memory-db';

const config = readSyncTestEndpoint();
const RUN = `health-live-${Date.now()}`;
const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
let user: AuthedTestClient;
// The helper types only what the sync suites call; this suite filters by prefix too.
const service = createLocalServiceRoleClient(config) as unknown as SupabaseClient;
type ActivityRow = { external_id: string };

const serverRows = async () => {
  const { data, error } = await service.schema(SYNC_RPC_SCHEMA).from('health_activities')
    .select('external_id,activity_type,distance_m,active_energy_kcal,max_heart_rate_bpm,elevation_gain_m,device_name')
    .eq('user_id', user.userId).like('external_id', `${RUN}-%`).order('external_id');
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
};
const removeRunRows = async () => {
  const { error } = await service.schema(SYNC_RPC_SCHEMA).from('health_activities')
    .delete().eq('user_id', user.userId).like('external_id', `${RUN}-%`);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  user = await createAuthedTestClient(config, USER_E);
  mockClientState.client = user.client;
  await removeRunRows();
});
afterAll(async () => {
  await removeRunRows();
  await user.teardown();
});

const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY_MS);
const run = (store: ReturnType<typeof fakeHealthStore>) => runHealthImport({
  userId: user.userId, adapter: store.adapter, api: healthImportApi, store: healthImportStore, now: NOW, isCurrent: () => true,
});

it('backfills, applies a deletion, and fails loud on a batch the server rejects', async () => {
  const store = fakeHealthStore();
  store.queue({
    workouts: [
      healthWorkout(`${RUN}-run`, { startDate: at(3), endDate: new Date(at(3).getTime() + 1800_000) }),
      healthWorkout(`${RUN}-lift`, {
        activityType: 'traditionalStrengthTraining', startDate: at(2), endDate: new Date(at(2).getTime() + 3600_000),
        totalDistance: null,
      }),
    ],
    deletedIds: [],
    newAnchor: 'anchor-1',
  });
  await expect(run(store)).resolves.toMatchObject({ status: 'imported', backfill: true, upserted: 2 });
  expect(store.reads[0].since.getTime()).toBe(NOW.getTime() - BACKFILL_DAYS * DAY_MS);
  expect(await serverRows()).toEqual([
    { external_id: `${RUN}-lift`, activity_type: 'traditional_strength_training', distance_m: null,
      active_energy_kcal: 351.2, max_heart_rate_bpm: 171, elevation_gain_m: 22, device_name: 'Apple Watch' },
    { external_id: `${RUN}-run`, activity_type: 'running', distance_m: 5012.3,
      active_energy_kcal: 351.2, max_heart_rate_bpm: 171, elevation_gain_m: 22, device_name: 'Apple Watch' },
  ]);

  store.queue({ workouts: [], deletedIds: [`${RUN}-lift`], newAnchor: 'anchor-2' });
  await expect(run(store)).resolves.toMatchObject({ status: 'imported', backfill: false, deleted: 1 });
  expect((await serverRows()).map((row: ActivityRow) => row.external_id)).toEqual([`${RUN}-run`]);
  expect(healthImportStore.readAnchor(user.userId)?.anchor).toBe('anchor-2');

  // A heart rate the server's range check refuses: the whole batch fails and the anchor stays.
  store.queue({ workouts: [healthWorkout(`${RUN}-bad`, { startDate: at(1), endDate: at(1), maxHeartRateBpm: 900 })], deletedIds: [], newAnchor: 'anchor-3' });
  await expect(run(store)).rejects.toMatchObject({ code: 'UPLOAD_FAILED', message: expect.stringContaining('INVALID_ARGUMENT') });
  expect(healthImportStore.readAnchor(user.userId)?.anchor).toBe('anchor-2');
  expect((await serverRows()).map((row: ActivityRow) => row.external_id)).toEqual([`${RUN}-run`]);
});

it('syncs Health bodyweight identity and preserves Ignore/deletion against a later stale device import', async () => {
  const device = createInMemoryDatabase();
  const uuid = randomUUID();
  const id = `apple-health-weight:${uuid}`;
  const measuredAt = new Date(Date.now() - 60_000);
  const scoped = user.client.schema(SYNC_RPC_SCHEMA);
  const push = async (entity: ReturnType<typeof entityToWire>) => {
    const response = await scoped.rpc('sync_push', { payload: { entities: [entity] } }) as { error: unknown };
    expect(response.error).toBeNull();
  };
  const read = async () => {
    const response = await service.schema(SYNC_RPC_SCHEMA).from('body_weight_measurements')
      .select('*').eq('owner_user_id', user.userId).eq('id', id).single();
    if (response.error) throw new Error(response.error.message);
    return response.data;
  };
  const expectRestored = async (ignored: boolean, deletedAt: number | null) => {
    let cursor: PullCursor = null;
    let found: WireEntity | undefined;
    do {
      const result = await scoped.rpc('sync_pull', { layer: 5, cursor, limit: 200 }) as {
        error: unknown; data: { entities: WireEntity[]; next_cursor: PullCursor; has_more: boolean };
      };
      expect(result.error).toBeNull();
      found = result.data.entities.find(entity => entity.type === 'body_weight_measurements' && entity.id === id) ?? found;
      cursor = result.data.has_more ? result.data.next_cursor : null;
    } while (cursor !== null);
    expect(found?.fields).toMatchObject({ source: 'apple_health', external_id: uuid, ignored, deleted_at: deletedAt });
    const restored = createInMemoryDatabase();
    try {
      restored.database.transaction(tx => applyPullPage(tx as Transaction, [found!], 'body_weight_measurements'));
      expect(restored.database.select().from(bodyWeightMeasurements).get()).toMatchObject({
        source: 'apple_health', externalId: uuid, ignored, deletedAt: deletedAt === null ? null : new Date(deletedAt),
      });
    } finally { restored.close(); }
  };
  try {
    device.database.transaction(tx => applyImportedBodyWeights(tx as Transaction,
      [{ uuid, weightKg: 81.25, measuredAt }], [], new Date()));
    const sample = device.database.select().from(bodyWeightMeasurements).get()!;
    const initial = entityToWire(sample, 'body_weight_measurements');
    await push(initial);
    expect(await read()).toMatchObject({ source: 'apple_health', external_id: uuid, ignored: false, deleted_at: null, client_updated_at_ms: 1 });
    await expectRestored(false, null);
    const choiceVersion = Date.now();
    const ignored = { ...initial, client_updated_at_ms: choiceVersion,
      fields: { ...initial.fields, ignored: true, deleted_at: choiceVersion } };
    await push(ignored);
    // Another phone imports the old native sample much later: its source
    // version is still 1, irrespective of that phone's clock.
    await push(initial);
    expect(await read()).toMatchObject({ ignored: true, deleted_at: choiceVersion });
    await expectRestored(true, choiceVersion);
    const legacy = { ...ignored, client_updated_at_ms: choiceVersion + 1, fields: { ...initial.fields } };
    delete legacy.fields.source; delete legacy.fields.external_id; delete legacy.fields.ignored;
    await push(legacy);
    expect(await read()).toMatchObject({ source: 'apple_health', external_id: uuid, ignored: true, deleted_at: choiceVersion });
    const deleted = { ...ignored, client_updated_at_ms: choiceVersion + 2,
      fields: { ...ignored.fields, ignored: false, deleted_at: choiceVersion + 2 } };
    await push(deleted); await push(initial);
    expect(await read()).toMatchObject({ ignored: false, deleted_at: choiceVersion + 2 });
    await expectRestored(false, choiceVersion + 2);
  } finally {
    device.close();
    const result = await service.schema(SYNC_RPC_SCHEMA).from('body_weight_measurements')
      .delete().eq('owner_user_id', user.userId).eq('id', id);
    if (result.error) throw new Error(result.error.message);
  }
});
