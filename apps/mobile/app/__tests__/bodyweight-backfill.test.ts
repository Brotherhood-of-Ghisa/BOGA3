import { eq } from 'drizzle-orm';
import { parseBackfillRange, planSessionWeightBackfill } from '@/src/bodyweight/backfill';
import { applySessionWeightBackfill, loadSessionWeightBackfill, previewSessionWeightBackfill } from '@/src/data/bodyweight-backfill';
import { correctSessionBodyWeight, deleteBodyWeightReading, saveBodyWeightReading } from '@/src/data/bodyweight';
import { bodyWeightMeasurements, sessions } from '@/src/data/schema';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
const all = { from: null, before: null };
const day = (value: number) => new Date(`2026-09-${String(value).padStart(2, '0')}T12:00:00Z`);
const addReading = (id: string, date: number, weightValue: string) => saveBodyWeightReading({
  weightValue, weightUnit: 'kg', measuredAt: day(date), now: day(25),
}).then(row => {
  mockFixture.database.update(bodyWeightMeasurements).set({ id }).where(eq(bodyWeightMeasurements.id, row.id)).run();
});
const seed = async () => {
  mockFixture.database.insert(sessions).values([5, 15, 21].map(date => ({ id: `s${date}`, startedAt: day(date),
    status: 'completed' as const, completedAt: new Date(day(date).getTime() + 3600000) }))).run();
  await addReading('r10', 10, '80'); await addReading('r20', 20, '82');
};
beforeEach(() => { __resetClockForTests(); mockFixture = createInMemoryDatabase(); });
afterEach(() => mockFixture.close());

it('previews preceding readings and explicit earliest-later estimates without writing, then freezes them', async () => {
  await seed();
  const inventory = await loadSessionWeightBackfill(all);
  expect(inventory.rows.map(row => row.status === 'ready' ? [row.sessionId, row.snapshot.bodyWeightKg, row.snapshot.bodyWeightSource] : row.reason))
    .toEqual([['s5', 80, 'historical_estimate'], ['s15', 80, 'reading'], ['s21', 82, 'reading']]);
  expect(mockFixture.database.select().from(sessions).all().every(row => row.bodyWeightKg === null)).toBe(true);
  const preview = previewSessionWeightBackfill(inventory, ['s5', 's15', 's21']);
  // A rendered value cannot replace the recomputed source.
  if (preview.rows[0].status === 'ready') preview.rows[0].snapshot.bodyWeightKg = 999;
  expect(await applySessionWeightBackfill(preview, day(25))).toEqual({ filled: 3, skipped: 0 });
  const saved = mockFixture.database.select().from(sessions).all();
  expect(saved.map(row => row.bodyWeightKg)).toEqual([80, 80, 82]);
  expect(saved[0]).toMatchObject({ bodyWeightSource: 'historical_estimate', bodyWeightMeasurementId: 'r10',
    bodyWeightMeasuredAt: day(10), localDirty: true, localBodyweightMetadataKnown: true });
  await addReading('r1', 1, '70');
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 0, skipped: 3 });
  expect((await loadSessionWeightBackfill(all)).rows).toHaveLength(0);
  await deleteBodyWeightReading('r10');
  expect(mockFixture.database.select().from(sessions).all().map(row => row.bodyWeightKg)).toEqual([80, 80, 82]);
});

it('preserves a concurrent manual correction and fills only the remaining missing selections', async () => {
  await seed();
  const preview = previewSessionWeightBackfill(await loadSessionWeightBackfill(all), ['s5', 's15']);
  await correctSessionBodyWeight('s5', { weightValue: '77', weightUnit: 'kg' });
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 1, skipped: 1 });
  expect(mockFixture.database.select().from(sessions).where(eq(sessions.id, 's5')).get())
    .toMatchObject({ bodyWeightKg: 77, bodyWeightSource: 'manual' });
  expect(mockFixture.database.select().from(sessions).where(eq(sessions.id, 's21')).get()?.bodyWeightKg).toBeNull();
});

it.each(['soft', 'hard'])('skips a %s deleted selection and fills the remaining sessions without recreating it', async deletion => {
  await seed();
  const preview = previewSessionWeightBackfill(await loadSessionWeightBackfill(all), ['s5', 's15']);
  if (deletion === 'soft') mockFixture.database.update(sessions).set({ deletedAt: day(25) }).where(eq(sessions.id, 's15')).run();
  else mockFixture.database.delete(sessions).where(eq(sessions.id, 's15')).run();
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 1, skipped: 1 });
  const deleted = mockFixture.database.select().from(sessions).where(eq(sessions.id, 's15')).get();
  if (deletion === 'soft') expect(deleted).toMatchObject({ deletedAt: day(25), bodyWeightKg: null });
  else expect(deleted).toBeUndefined();
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 0, skipped: 2 });
});

it.each(['new reading', 'edited reading', 'deleted reading', 'session date', 'new session', 'active session', 'unselected deleted session'])(
  'rejects a stale preview after %s with no partial writes', async change => {
    await seed();
    const preview = previewSessionWeightBackfill(await loadSessionWeightBackfill(all), ['s5', 's15']);
    if (change === 'new reading') await addReading('r1', 1, '70');
    if (change === 'edited reading') mockFixture.database.update(bodyWeightMeasurements).set({ weightKg: 81, weightValue: '81' }).run();
    if (change === 'deleted reading') await deleteBodyWeightReading('r10');
    if (change === 'session date') mockFixture.database.update(sessions).set({ startedAt: day(22) }).where(eq(sessions.id, 's15')).run();
    if (change === 'new session') mockFixture.database.insert(sessions).values({ id: 'new', status: 'completed', startedAt: day(17) }).run();
    if (change === 'active session') mockFixture.database.update(sessions).set({ status: 'active' }).where(eq(sessions.id, 's15')).run();
    if (change === 'unselected deleted session') mockFixture.database.update(sessions).set({ deletedAt: day(25) }).where(eq(sessions.id, 's21')).run();
    await expect(applySessionWeightBackfill(preview)).rejects.toThrow(/changed/);
    expect(mockFixture.database.select().from(sessions).all().every(row => row.bodyWeightKg === null)).toBe(true);
  }
);

it('blocks absent/invalid readings and unhydrated sessions; does not overwrite invalid nonempty snapshots', async () => {
  await seed();
  mockFixture.database.delete(bodyWeightMeasurements).run();
  let inventory = await loadSessionWeightBackfill(all);
  expect(inventory.hasReadings).toBe(false);
  expect(() => previewSessionWeightBackfill(inventory, ['s5'])).toThrow('Add a weight reading');
  await addReading('invalid', 10, '80');
  mockFixture.database.update(bodyWeightMeasurements).set({ weightKg: 0 }).run();
  expect((await loadSessionWeightBackfill(all)).rows.every(row => row.status === 'blocked')).toBe(true);
  mockFixture.database.update(bodyWeightMeasurements).set({ weightKg: 80 }).run();
  mockFixture.database.update(sessions).set({ localBodyweightMetadataKnown: false }).where(eq(sessions.id, 's5')).run();
  mockFixture.database.update(sessions).set({ bodyWeightKg: 0 }).where(eq(sessions.id, 's15')).run();
  inventory = await loadSessionWeightBackfill(all);
  expect(inventory.rows.map(row => row.sessionId)).toEqual(['s5', 's21']);
  expect(() => previewSessionWeightBackfill(inventory, ['s5'])).toThrow('Sync');
});

it('uses deterministic same-time ties and ignores tombstones and active sessions', async () => {
  await seed(); await addReading('A', 10, '79'); await addReading('a', 10, '81');
  mockFixture.database.update(sessions).set({ status: 'active' }).where(eq(sessions.id, 's21')).run();
  await deleteBodyWeightReading('r10');
  const inventory = await loadSessionWeightBackfill(all);
  expect(inventory.rows.map(row => row.status === 'ready' && row.snapshot.bodyWeightKg)).toEqual([79, 79]);
});

it('uses local calendar boundaries including the entire end day and rejects invalid ranges', async () => {
  await seed();
  const range = parseBackfillRange('2026-09-15', '2026-09-21');
  expect(range.from?.getHours()).toBe(0);
  expect(range.before?.getDate()).toBe(22);
  const inventory = await loadSessionWeightBackfill(range);
  expect(inventory.rows.map(row => row.sessionId)).toEqual(['s15', 's21']);
  expect(() => parseBackfillRange('2026-09-31', '')).toThrow('valid calendar');
  expect(() => parseBackfillRange('2026-09-22', '2026-09-21')).toThrow('end date');
  expect(parseBackfillRange('', '')).toEqual(all);
  expect(planSessionWeightBackfill([], [])).toEqual([]);
});

it('rolls back a storage failure and safely retries the unchanged preview', async () => {
  await seed();
  const preview = previewSessionWeightBackfill(await loadSessionWeightBackfill(all), ['s5', 's15', 's21']);
  mockFixture.client.exec(`CREATE TRIGGER fail_backfill BEFORE UPDATE ON sessions
    WHEN NEW.id = 's15' AND NEW.body_weight_kg IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'test storage failure'); END`);
  const before = mockFixture.database.select().from(sessions).all();
  const nudge = jest.requireMock('@/src/sync/write-nudge').notifyLocalWrite as jest.Mock;
  nudge.mockClear();
  // Native SQLite errors may originate in another Jest realm. Check the
  // rejected payload, as the existing transaction-failure tests do.
  await expect(applySessionWeightBackfill(preview)).rejects.toMatchObject({
    message: 'test storage failure', code: 'SQLITE_CONSTRAINT_TRIGGER',
  });
  expect(mockFixture.database.select().from(sessions).all()).toEqual(before);
  expect(nudge).not.toHaveBeenCalled();
  mockFixture.client.exec('DROP TRIGGER fail_backfill');
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 3, skipped: 0 });
  expect(nudge).toHaveBeenCalledTimes(1);
});

it('includes local end-of-day sessions, excludes next midnight and ignores transport acknowledgements', async () => {
  await seed();
  mockFixture.database.insert(sessions).values([
    { id: 'end', status: 'completed', startedAt: new Date(2026, 8, 21, 23, 59, 59, 999) },
    { id: 'next', status: 'completed', startedAt: new Date(2026, 8, 22, 0, 0, 0, 0) },
  ]).run();
  const inventory = await loadSessionWeightBackfill(parseBackfillRange('2026-09-21', '2026-09-21'));
  expect(inventory.rows.map(row => row.sessionId)).toEqual(['s21', 'end']);
  const preview = previewSessionWeightBackfill(inventory, ['end']);
  mockFixture.database.update(bodyWeightMeasurements).set({ localDirty: false }).run();
  mockFixture.database.update(sessions).set({ localDirty: false }).run();
  expect(await applySessionWeightBackfill(preview)).toEqual({ filled: 1, skipped: 0 });
});


it('restores applied estimates through ordinary sync after a wipe and keeps a later correction under LWW', async () => {
  await seed();
  await applySessionWeightBackfill(previewSessionWeightBackfill(await loadSessionWeightBackfill(all), ['s5', 's15', 's21']));
  const sessionRows = mockFixture.database.select().from(sessions).all();
  const sessionWire = JSON.parse(JSON.stringify(sessionRows.map(row => entityToWire(row, 'sessions'))));
  const readingWire = mockFixture.database.select().from(bodyWeightMeasurements).all().map(row => entityToWire(row, 'body_weight_measurements'));
  mockFixture.close(); mockFixture = createInMemoryDatabase();
  const db = mockFixture.database;
  // Snapshot provenance is not an FK to the measurement. It survives restore order and later source deletion.
  expect(db.transaction(tx => applyPullPage(tx as Transaction, sessionWire, 'sessions'))).toBe(3);
  expect(db.transaction(tx => applyPullPage(tx as Transaction, readingWire, 'body_weight_measurements'))).toBe(2);
  for (const original of sessionRows) {
    expect(db.select().from(sessions).where(eq(sessions.id, original.id)).get()).toMatchObject({
      bodyWeightKg: original.bodyWeightKg, bodyWeightSource: original.bodyWeightSource,
      bodyWeightMeasurementId: original.bodyWeightMeasurementId, bodyWeightMeasuredAt: original.bodyWeightMeasuredAt,
      localDirty: false, localBodyweightMetadataKnown: true,
    });
  }
  expect((await loadSessionWeightBackfill(all)).rows).toHaveLength(0);
  await deleteBodyWeightReading('r10');
  expect(db.select().from(sessions).where(eq(sessions.id, 's5')).get()).toMatchObject({
    bodyWeightKg: 80, bodyWeightSource: 'historical_estimate', bodyWeightMeasuredAt: day(10),
  });
  await correctSessionBodyWeight('s5', { weightValue: '77', weightUnit: 'kg' });
  db.transaction(tx => applyPullPage(tx as Transaction, sessionWire, 'sessions'));
  expect(db.select().from(sessions).where(eq(sessions.id, 's5')).get()).toMatchObject({
    bodyWeightKg: 77, bodyWeightSource: 'manual', bodyWeightMeasurementId: null, localDirty: true,
  });
});


it('matches SQLite same-time id ordering for imported non-ASCII identifiers', async () => {
  const db = mockFixture.database;
  db.insert(sessions).values({ id: 'historic', startedAt: day(15), status: 'completed', completedAt: day(16) }).run();
  await addReading('😀', 10, '90');
  await addReading('\uE000', 10, '80');
  const row = (await loadSessionWeightBackfill(all)).rows[0];
  expect(row).toMatchObject({ status: 'ready', snapshot: { bodyWeightKg: 80, bodyWeightMeasurementId: '\uE000' } });
});
