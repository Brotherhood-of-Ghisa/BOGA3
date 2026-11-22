import { eq } from 'drizzle-orm';

import { applyImportedBodyWeights, deleteBodyWeightReading, listBodyWeightReadings, readCurrentBodyWeight,
  saveBodyWeightReading, setBodyWeightReadingIgnored } from '@/src/data/bodyweight';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { bodyWeightMeasurements } from '@/src/data/schema';
import { healthWeightIdentity } from '@/src/bodyweight/weight-entry';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));

const UUID = 'AAAAAAAA-1111-2222-3333-444444444444';
const identity = healthWeightIdentity(UUID);
const at = new Date('2026-11-22T12:00:00.123Z');
const now = new Date(at.getTime() + 60_000);
const sample = { uuid: UUID, weightKg: 81.123456789, measuredAt: at };
const importRows = (deletes: string[] = [], readings = [sample]) => mockFixture.database.transaction(tx =>
  applyImportedBodyWeights(tx as Transaction, readings, deletes, now));
const row = () => mockFixture.database.select().from(bodyWeightMeasurements)
  .where(eq(bodyWeightMeasurements.id, identity.id)).get()!;

beforeEach(() => { __resetClockForTests(); mockFixture = createInMemoryDatabase(); });
afterEach(() => mockFixture.close());

it('imports canonical immutable readings once at source version 1, used by default', async () => {
  importRows();
  importRows([], [{ ...sample, uuid: UUID.toLowerCase() }]);
  expect(await listBodyWeightReadings()).toHaveLength(1);
  expect(row()).toMatchObject({ ...identity, source: 'apple_health', ignored: false, deletedAt: null,
    weightKg: sample.weightKg, measuredAt: at, createdAt: at, updatedAt: at, localDirty: true, localUpdatedAtMs: 1 });
  expect(await readCurrentBodyWeight(now)).toMatchObject({ id: identity.id });
});

it('keeps imported values read-only and manual readings editable', async () => {
  importRows();
  await expect(saveBodyWeightReading({ id: identity.id, weightValue: '90', measuredAt: at, now })).rejects.toThrow('read-only');
  await expect(deleteBodyWeightReading(identity.id, now)).rejects.toThrow('read-only');
  const manual = await saveBodyWeightReading({ weightValue: '77', measuredAt: at, now });
  await expect(saveBodyWeightReading({ id: manual.id, weightValue: '78', measuredAt: at, now })).resolves.toMatchObject({ weightKg: 78, source: 'manual' });
  await expect(setBodyWeightReadingIgnored(manual.id, true, now)).rejects.toThrow('no longer available');
});

it('keeps ignored readings visible, falls back to the previous reading, and restores them explicitly', async () => {
  await saveBodyWeightReading({ weightValue: '77', measuredAt: new Date(at.getTime() - 1), now });
  importRows();
  await setBodyWeightReadingIgnored(identity.id, true, now);
  const ignored = row();
  expect(ignored).toMatchObject({ ignored: true, deletedAt: now });
  expect(ignored.localUpdatedAtMs).toBeGreaterThan(1);
  expect(await listBodyWeightReadings()).toHaveLength(2);
  expect(await readCurrentBodyWeight(now)).toMatchObject({ weightKg: 77 });
  importRows();
  expect(row()).toEqual(ignored);
  await setBodyWeightReadingIgnored(identity.id, false, now);
  expect(await readCurrentBodyWeight(now)).toMatchObject({ id: identity.id, ignored: false, deletedAt: null });
});

it('a Health deletion hides an ignored reading and a stale open sheet cannot restore it', async () => {
  importRows();
  await setBodyWeightReadingIgnored(identity.id, true, now);
  importRows([UUID], []);
  expect(row()).toMatchObject({ ignored: false, deletedAt: now });
  expect(await listBodyWeightReadings()).toEqual([]);
  await expect(setBodyWeightReadingIgnored(identity.id, false, now)).rejects.toThrow('no longer available');
  importRows();
  expect(await readCurrentBodyWeight(now)).toBeNull();
});

it('keeps a hidden tombstone when deletion arrives before the sample', async () => {
  importRows([UUID], []);
  expect(row()).toMatchObject({ weightKg: 0, measuredAt: new Date(0), ignored: false, deletedAt: now });
  importRows();
  expect(await readCurrentBodyWeight(now)).toBeNull();
  expect(await listBodyWeightReadings()).toEqual([]);
});

it('a later phone import cannot overwrite a synced Ignore choice or deletion', async () => {
  importRows();
  const staleImport = entityToWire(row() as unknown as Parameters<typeof entityToWire>[0], 'body_weight_measurements');
  await setBodyWeightReadingIgnored(identity.id, true, now);
  const ignored = row();
  mockFixture.database.transaction(tx => applyPullPage(tx as Transaction, [staleImport], 'body_weight_measurements'));
  expect(row()).toEqual(ignored);
  importRows([UUID], []);
  const deleted = row();
  mockFixture.database.transaction(tx => applyPullPage(tx as Transaction, [staleImport], 'body_weight_measurements'));
  expect(row()).toEqual(deleted);
});

it('legacy pull envelopes preserve imported identity, Ignore and its tombstone', async () => {
  importRows();
  await setBodyWeightReadingIgnored(identity.id, true, now);
  const ignored = row();
  const legacy = entityToWire(ignored as unknown as Parameters<typeof entityToWire>[0], 'body_weight_measurements');
  delete legacy.fields.source; delete legacy.fields.external_id; delete legacy.fields.ignored;
  legacy.fields.deleted_at = null;
  legacy.client_updated_at_ms += 1;
  mockFixture.database.transaction(tx => applyPullPage(tx as Transaction, [legacy], 'body_weight_measurements'));
  expect(row()).toMatchObject({ ...identity, source: 'apple_health', ignored: true, deletedAt: now });
});

it('rejects an invalid batch atomically and validates source UUIDs', () => {
  expect(() => importRows([], [sample, { ...sample, uuid: 'bbbbbbbb-1111-2222-3333-444444444444', weightKg: NaN }])).toThrow('invalid weight');
  expect(mockFixture.database.select().from(bodyWeightMeasurements).all()).toEqual([]);
  expect(() => healthWeightIdentity('bad')).toThrow('invalid measurement identifier');
});

it('hydrates upgraded dirty Health rows without converting them to manual or resetting server inclusion', () => {
  importRows();
  const incoming = entityToWire(row() as unknown as Parameters<typeof entityToWire>[0], 'body_weight_measurements');
  incoming.client_updated_at_ms = 10;
  incoming.fields.ignored = true; incoming.fields.deleted_at = now.getTime();
  mockFixture.database.update(bodyWeightMeasurements).set({ source: 'manual', externalId: null,
    weightKg: 82, localDirty: true, localUpdatedAtMs: 100 }).run();
  mockFixture.database.transaction(tx => applyPullPage(tx as Transaction, [incoming], 'body_weight_measurements'));
  expect(row()).toMatchObject({ source: 'apple_health', externalId: identity.externalId,
    ignored: true, deletedAt: now, weightKg: 82, localDirty: true, localUpdatedAtMs: 100 });
});

it('an older used envelope cannot hydrate away a native deletion on an upgraded legacy row', () => {
  importRows();
  const older = entityToWire(row() as unknown as Parameters<typeof entityToWire>[0], 'body_weight_measurements');
  mockFixture.database.update(bodyWeightMeasurements).set({ externalId: null }).run();
  importRows([UUID], []);
  const deleted = row();
  mockFixture.database.transaction(tx => applyPullPage(tx as Transaction, [older], 'body_weight_measurements'));
  expect(row()).toEqual(deleted);
  expect(row()).toMatchObject({ externalId: identity.externalId, ignored: false, deletedAt: now });
});
