import { eq } from 'drizzle-orm';
import { __resetClockForTests } from '@/src/data/clock';
import { bodyWeightMeasurements, sessions } from '@/src/data/schema';
import { createSessionDraftRepository } from '@/src/data/session-drafts';
import { deleteBodyWeightReading, listBodyWeightReadings,
  readCurrentBodyWeight, saveBodyWeightReading } from '@/src/data/bodyweight';
import { isValidSessionWeight, resolveMeasurementDate, validateBodyWeight } from '@/src/bodyweight/weight-entry';
import { loadActiveSessionGraph, setSessionGym, completeActiveSession } from '@/src/session-recorder/session-lifecycle';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));
const now = new Date('2026-09-20T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86400000);
const save = (weightValue: string, measuredAt: Date, id?: string, weightUnit = 'kg') =>
  saveBodyWeightReading({ weightValue, weightUnit, measuredAt, now, id });
const newSession = (startedAt: Date) => createSessionDraftRepository().persistDraftSnapshot({ gymId: null, startedAt, exercises: [] });

beforeEach(() => { __resetClockForTests(); mockFixture = createInMemoryDatabase(); jest.clearAllMocks(); });
afterEach(() => mockFixture.close());

it('saves offline with raw units, normalization and a monotonic sync write', async () => {
  const reading = await save(' 176.4 ', at(-1), undefined, 'lb');
  expect(reading).toMatchObject({ weightValue: '176.4', weightUnit: 'lb', weightKg: 176.4 * 0.45359237,
    measuredAt: at(-1), localDirty: true, deletedAt: null });
  expect(reading.localUpdatedAtMs).toBeGreaterThan(0);
  expect(notifyLocalWrite).toHaveBeenCalledTimes(1);
  expect(await readCurrentBodyWeight(now)).toEqual(reading);
});

it.each(['', '0', '-1', 'Infinity', 'NaN', '1e2', '80,5', 'abc'])('rejects invalid reading %s without a write', async weightValue => {
  await expect(save(weightValue, at(-1))).rejects.toThrow();
  expect(await listBodyWeightReadings()).toEqual([]);
  expect(notifyLocalWrite).not.toHaveBeenCalled();
});

it('rejects invalid units and future dates, including edits', async () => {
  await expect(save('80', at(-1), undefined, 'stone')).rejects.toThrow('kg or lb');
  await expect(save('80', at(1))).rejects.toThrow('future');
  await expect(save('80', new Date(NaN))).rejects.toThrow('date');
  const reading = await save('80', at(-1));
  await expect(save('90', at(1), reading.id)).rejects.toThrow('future');
  expect((await readCurrentBodyWeight(now))?.weightKg).toBe(80);
});

it('selects by measurement time, not edit time, with stable ascending ids for ties', async () => {
  const old = await save('75', at(-3));
  const latest = await save('80', at(-1));
  await save('76', at(-3), old.id);
  expect((await readCurrentBodyWeight(now))?.id).toBe(latest.id);
  mockFixture.database.insert(bodyWeightMeasurements).values([
    { id: 'a-tie', weightValue: '81', weightUnit: 'kg', weightKg: 81, measuredAt: now },
    { id: 'z-tie', weightValue: '82', weightUnit: 'kg', weightKg: 82, measuredAt: now },
  ]).run();
  expect((await readCurrentBodyWeight(now))?.id).toBe('a-tie');
  await deleteBodyWeightReading('a-tie', now);
  expect((await readCurrentBodyWeight(now))?.id).toBe('z-tie');
});

it('resolves from the recorded start on every read, including a changed session start', async () => {
  const reading = await save('80', at(-2));
  const repo = createSessionDraftRepository();
  const first = await newSession(at(-1));
  expect(await repo.loadSessionSnapshotById(first.sessionId)).toMatchObject({ bodyWeightKg: 80,
    bodyWeightSource: 'reading', bodyWeightMeasurementId: reading.id, bodyWeightMeasuredAt: at(-2) });
  await save('85', now);
  const second = await newSession(now);
  expect((await repo.loadSessionSnapshotById(second.sessionId))?.bodyWeightKg).toBe(85);
  // Moving the start selects the later reading; source edits cannot override it.
  await repo.persistDraftSnapshot({ ...first, gymId: null, startedAt: now, exercises: [] });
  await save('90', at(-2), reading.id);
  await deleteBodyWeightReading(reading.id, now);
  expect((await repo.loadSessionSnapshotById(first.sessionId))?.bodyWeightKg).toBe(85);
  const earlier = await newSession(at(-5));
  expect(await repo.loadSessionSnapshotById(earlier.sessionId)).toMatchObject({ bodyWeightKg: null,
    bodyWeightSource: null, bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null });
});

it('does not borrow an older valid reading when the latest restored reading is malformed', async () => {
  await save('80', at(-3));
  mockFixture.database.insert(bodyWeightMeasurements).values({ id: 'bad', weightValue: '85', weightKg: 850,
    weightUnit: 'kg', measuredAt: at(-1) }).run();
  const session = await newSession(now);
  expect((await createSessionDraftRepository().loadSessionSnapshotById(session.sessionId))?.bodyWeightKg).toBeNull();
});

it('recalculates historical context without modifying the session row or its sync clock', async () => {
  const reading = await save('80', at(-2));
  const { sessionId } = await newSession(at(-1));
  const before = mockFixture.database.select().from(sessions).get();
  const load = () => createSessionDraftRepository().loadSessionSnapshotById(sessionId);
  await save('180', at(-2), reading.id, 'lb');
  expect((await load())?.bodyWeightKg).toBe(180 * 0.45359237);
  await save('180', now, reading.id, 'lb');
  expect((await load())?.bodyWeightKg).toBeNull();
  await save('80', at(-2), reading.id);
  await deleteBodyWeightReading(reading.id, now);
  expect((await load())?.bodyWeightKg).toBeNull();
  mockFixture.database.update(bodyWeightMeasurements).set({ deletedAt: null }).where(eq(bodyWeightMeasurements.id, reading.id)).run();
  expect((await load())?.bodyWeightKg).toBe(80);
  expect(mockFixture.database.select().from(sessions).get()).toEqual(before);
});

it('keeps exact measurement precision when its displayed date is unchanged', () => {
  const exact = new Date('2026-09-01T10:23:45.678Z');
  expect(resolveMeasurementDate(formatCurrentDateTime(exact), exact, now)).toBe(exact);
  expect(resolveMeasurementDate(formatCurrentDateTime(at(-1)), exact, now).getSeconds()).toBe(0);
  expect(() => resolveMeasurementDate('2026-02-31 12:00', exact, now)).toThrow('valid');
  expect(() => resolveMeasurementDate(formatCurrentDateTime(at(1)), exact, now)).toThrow('future');
  expect(validateBodyWeight({ weightValue: '80.2', weightUnit: 'kg' }).weightKg).toBe(80.2);
});

it('validates dated context instead of accepting positive kg alone', () => {
  expect(isValidSessionWeight({ bodyWeightKg: 80 })).toBe(false);
  expect(isValidSessionWeight({ bodyWeightKg: 80, bodyWeightSource: 'manual' })).toBe(false);
  expect(isValidSessionWeight({ bodyWeightKg: 80, bodyWeightSource: 'manual', bodyWeightMeasurementId: 'x' })).toBe(false);
  expect(isValidSessionWeight({ bodyWeightKg: 80, bodyWeightSource: 'historical_estimate',
    bodyWeightMeasurementId: 'x', bodyWeightMeasuredAt: now })).toBe(false);
  expect(isValidSessionWeight({ bodyWeightKg: Infinity, bodyWeightSource: 'manual' })).toBe(false);
});


it('preserves exact active-session start through ordinary edits and completion', async () => {
  const startedAt = new Date('2026-09-01T12:00:30.123Z');
  const { sessionId } = await newSession(startedAt);
  const reading = await save('80', startedAt);
  const graph = await loadActiveSessionGraph(sessionId);
  expect(graph?.startedAt).toEqual(startedAt);
  await setSessionGym(sessionId, null);
  expect((await createSessionDraftRepository().loadSessionSnapshotById(sessionId))?.bodyWeightMeasurementId).toBe(reading.id);
  await completeActiveSession({ sessionId, gymId: null, startedAt: graph!.startedAt, completedHistorySession: graph!.session });
  expect(await createSessionDraftRepository().loadSessionSnapshotById(sessionId)).toMatchObject({ startedAt, bodyWeightKg: 80 });
});
