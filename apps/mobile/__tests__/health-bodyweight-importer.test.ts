import { runBodyWeightImport } from '@/src/health-import/bodyweight-importer';
import type { BodyWeightImportSettings, BodyWeightImportStore } from '@/src/health-import/bodyweight-storage';
import type { BodyWeightHealthStoreAdapter, HealthBodyWeightChanges } from '@/src/health-import/types';
import { bodyWeightMeasurements, syncRuntimeState } from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));

const since = new Date('2026-11-22T12:00:00.123Z');
const uuid = 'aaaaaaaa-1111-2222-3333-444444444444';
let settings: BodyWeightImportSettings;
const store: BodyWeightImportStore = { read: () => ({ ...settings }), write: (_user, next) => { settings = { ...next }; } };
const adapter: BodyWeightHealthStoreAdapter = {
  supported: true, requestAuthorization: async () => undefined,
  readChanges: jest.fn(async (): Promise<HealthBodyWeightChanges> => ({
    samples: [{ uuid, weightKg: 80, measuredAt: since }], deletedIds: [], newAnchor: 'next',
  })),
};
const run = (isCurrent = () => true) => runBodyWeightImport({ userId: 'owner', store, adapter,
  now: () => new Date(since.getTime() + 100), isCurrent });
beforeEach(() => {
  mockFixture = createInMemoryDatabase();
  mockFixture.database.insert(syncRuntimeState).values({ id: 'primary', accountUserId: 'owner', bootstrapCompletedAt: since }).run();
  settings = { enabled: true, since: since.toISOString(), anchor: null };
  jest.mocked(adapter.readChanges).mockClear();
});
afterEach(() => mockFixture.close());

it('imports only measurements at or after the enable instant and advances after durable writes', async () => {
  jest.mocked(adapter.readChanges).mockResolvedValueOnce({ samples: [
    { uuid: 'bbbbbbbb-1111-2222-3333-444444444444', weightKg: 79, measuredAt: new Date(since.getTime() - 1) },
    { uuid, weightKg: 80, measuredAt: since },
  ], deletedIds: [], newAnchor: 'next' });
  await expect(run()).resolves.toBe(true);
  expect(adapter.readChanges).toHaveBeenCalledWith({ since, anchor: null });
  expect(mockFixture.database.select().from(bodyWeightMeasurements).all()).toHaveLength(1);
  expect(settings.anchor).toBe('next');
});

it('keeps the cursor on empty/denied reads, including after previous imports', async () => {
  settings.anchor = 'previous';
  jest.mocked(adapter.readChanges).mockResolvedValueOnce({ samples: [], deletedIds: [], newAnchor: 'hidden' });
  await run();
  expect(settings.anchor).toBe('previous');
});

it('retries the same feed after a native failure or invalid batch', async () => {
  jest.mocked(adapter.readChanges).mockRejectedValueOnce(new Error('native failure'));
  await expect(run()).rejects.toThrow('native failure');
  expect(settings.anchor).toBeNull();
  jest.mocked(adapter.readChanges).mockResolvedValueOnce({ samples: [{ uuid, weightKg: -1, measuredAt: since }], deletedIds: [], newAnchor: 'bad' });
  await expect(run()).rejects.toThrow('invalid weight');
  expect(settings.anchor).toBeNull();
  expect(mockFixture.database.select().from(bodyWeightMeasurements).all()).toEqual([]);
  await run();
  expect(settings.anchor).toBe('next');
});

it('does not write to a different account, an unrestored database, or after cancellation', async () => {
  mockFixture.database.update(syncRuntimeState).set({ accountUserId: 'other' }).run();
  await expect(run()).resolves.toBe(false);
  mockFixture.database.update(syncRuntimeState).set({ accountUserId: 'owner', bootstrapCompletedAt: null }).run();
  await expect(run()).resolves.toBe(false);
  mockFixture.database.update(syncRuntimeState).set({ bootstrapCompletedAt: since }).run();
  let calls = 0;
  await expect(run(() => ++calls === 1)).resolves.toBe(false);
  expect(mockFixture.database.select().from(bodyWeightMeasurements).all()).toEqual([]);
  expect(settings.anchor).toBeNull();
});

it('does not read while disabled or without an enable cutoff', async () => {
  settings.enabled = false;
  await expect(run()).resolves.toBe(false);
  settings.enabled = true; settings.since = null;
  await expect(run()).resolves.toBe(false);
  expect(adapter.readChanges).not.toHaveBeenCalled();
});

it('accepts a measurement made while the native query was still pending', async () => {
  let complete!: (value: HealthBodyWeightChanges) => void;
  jest.mocked(adapter.readChanges).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let clock = since.getTime();
  const pending = runBodyWeightImport({ userId: 'owner', store, adapter, now: () => new Date(clock), isCurrent: () => true });
  clock += 20;
  complete({ samples: [{ uuid, weightKg: 80, measuredAt: new Date(clock - 10) }], deletedIds: [], newAnchor: 'next' });
  await expect(pending).resolves.toBe(true);
  expect(settings.anchor).toBe('next');
});
