import { act, renderHook, waitFor } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import wave from './fixtures/rm-curve-weekly-wave.json';
import oracle from './fixtures/rm-curve-weekly-wave-oracle.json';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { bodyWeightMeasurements, exerciseDefinitions, exerciseSets, sessionExercises, sessions, userSettings } from '@/src/data/schema';
import { loadRmCurveGraph } from '@/src/data/rm-curve';
import { configurePersonalEffortPolicy } from '@/src/config/personal-effort';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '@/src/exercise-calculations/effort-policy';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { invalidateExerciseCatalogCache } from '@/src/exercise-catalog/invalidation';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { loadRmCurve, createRmCurveRepository } from '@/src/rm-curve/repository';
import { useRmCurve } from '@/src/rm-curve/use-rm-curve';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
const start = new Date(wave.scenarios.plateau[0].startedAt);
const query = { exerciseDefinitionId: 'curve', start,
  end: new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1), historyLookbackWeeks: 52, gym: 'latest' as const };

const seed = (scenario: keyof typeof wave.scenarios = 'plateau') => seedWaveHistory(mockFixture.database, scenario);
beforeEach(() => { mockFixture = createInMemoryDatabase(); configurePersonalEffortPolicy(DEFAULT_PERSONAL_EFFORT_POLICY); });
afterEach(() => { configurePersonalEffortPolicy(DEFAULT_PERSONAL_EFFORT_POLICY); mockFixture.close(); });

it.each(['plateau', 'stable', 'gradual'] as const)('reads every frozen %s prefix through real migrated SQLite', async name => {
  seed(name);
  for (const expected of oracle.oracle.find(control => control.name === name)!.weekly) {
    const model = await loadRmCurve({ ...query, end: new Date(wave.scenarios[name][expected.week * 3 - 1].completedAt + 1) });
    expect(model?.observations).toHaveLength(expected.sets);
    expect(model?.reference).toMatchObject({ totalRm: 100, qualifyingSessions: 6 });
    const ids = new Set(model!.observations.map(p => p.setId)); expect(ids.size).toBe(expected.sets);
    for (const point of model!.observations) {
      const original = wave.scenarios[name].find(row => `${row.session}:${row.set}` === point.setId)!;
      expect(point.analyticalTotalRm).toBeCloseTo(original.analyticalRm, 8);
      expect(point.existingOneRepMax).toBeCloseTo(original.rm, 8);
    }
  }
});

it('hides tombstoned/noncompleted/unlinked graphs, retains raw effort/status and returns unavailable exercises', async () => {
  seed(); const db = mockFixture.database;
  db.update(exerciseSets).set({ deletedAt: query.end }).where(eq(exerciseSets.id, 'week-24:3')).run();
  db.update(sessionExercises).set({ deletedAt: query.end }).where(eq(sessionExercises.id, 'week-23:block:1')).run();
  db.update(sessions).set({ deletedAt: query.end }).where(eq(sessions.id, 'week-22')).run();
  db.update(sessions).set({ status: 'active' }).where(eq(sessions.id, 'week-21')).run();
  db.update(sessionExercises).set({ exerciseDefinitionId: null }).where(eq(sessionExercises.id, 'week-20:block:1')).run();
  db.update(exerciseSets).set({ setType: 'rir_12' }).where(eq(exerciseSets.id, 'week-24:1')).run();
  db.update(exerciseSets).set({ performanceStatus: 'unexpected_status' }).where(eq(exerciseSets.id, 'week-24:2')).run();
  db.update(exerciseSets).set({ weightValue: '', repsValue: '', plannedWeightValue: '100', plannedRepsValue: '8', plannedSetType: 'rir_0' })
    .where(eq(exerciseSets.id, 'week-23:1')).run();
  const graph = await loadRmCurveGraph({ ...query, start: new Date(2025, 0, 1) });
  expect(graph?.rows.find(row => row.setId === 'week-24:1')?.setType).toBe('rir_12');
  expect(graph?.rows.find(row => row.setId === 'week-24:2')?.performanceStatus).toBe('unexpected_status');
  const model = await loadRmCurve(query);
  expect(model?.observations).toHaveLength(61);
  expect(model?.observations.find(row => row.setId === 'week-24:1')?.rir).toBe(12);
  expect(model?.excluded.not_working).toBe(2);
  expect(await loadRmCurve({ ...query, exerciseDefinitionId: 'missing' })).toBeNull();
  db.update(exerciseDefinitions).set({ deletedAt: query.end }).where(eq(exerciseDefinitions.id, 'curve')).run();
  expect(await loadRmCurve(query)).toBeNull();
});

it('recalculates dated bodyweight, mode, preference and metadata without changing source sets', async () => {
  seed(); const db = mockFixture.database;
  db.update(exerciseDefinitions).set({ bodyweightContribution: 0.25, loadInputMode: 'per_side_load' }).where(eq(exerciseDefinitions.id, 'curve')).run();
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  db.insert(bodyWeightMeasurements).values({ id: 'old', measuredAt: new Date(2025, 0, 1), weightKg: 80 }).run();
  db.insert(bodyWeightMeasurements).values({ id: 'future', measuredAt: new Date(query.end.getTime() + 1), weightKg: 120 }).run();
  const initial = await loadRmCurve(query); const row = initial!.observations[0];
  expect(row.loadKg).toBeCloseTo(row.weightKg + 10); expect(row.bodyWeightMeasurementId).toBe('old');
  const before = db.select().from(exerciseSets).all();
  db.update(bodyWeightMeasurements).set({ weightKg: 88 }).where(eq(bodyWeightMeasurements.id, 'old')).run();
  const changed = (await loadRmCurve(query))!.observations[0]; expect(changed.loadKg - row.loadKg).toBeCloseTo(1);
  expect(changed.weightValue).toBe(row.weightValue); expect(changed.bodyWeightMeasurementId).toBe('old');
  db.update(userSettings).set({ bodyweightCalculationsEnabled: false }).run();
  const off = (await loadRmCurve(query))!.observations[0];
  expect(off.loadKg).toBe(off.weightKg); expect(off.bodyWeightMeasurementId).toBeNull();
  db.update(userSettings).set({ bodyweightCalculationsEnabled: true }).run();
  db.update(bodyWeightMeasurements).set({ deletedAt: query.end }).where(eq(bodyWeightMeasurements.id, 'old')).run();
  const missing = (await loadRmCurve(query))!.observations[0]; expect(missing.loadKg).toBe(missing.weightKg);
  db.update(exerciseDefinitions).set({ bodyweightContribution: 0, name: 'Renamed', loadInputMode: 'total_load' }).run();
  const renamed = await loadRmCurve(query); expect(renamed?.definition.name).toBe('Renamed');
  expect(renamed?.observations[0].calculatedLoadKg).toBe(renamed?.observations[0].weightKg);
  expect(db.select().from(exerciseSets).all()).toEqual(before);
});

it('applies personal effort filtering and boundary ties to both cohorts without widening a sparse reference', async () => {
  seed(); const db = mockFixture.database;
  db.update(sessions).set({ completedAt: start }).where(eq(sessions.id, 'week--1')).run();
  const model = await loadRmCurve(query); expect(model?.reference.totalRm).toBeNull();
  expect(model?.reference.qualifyingSessions).toBe(5);
  expect(model?.observations.some(p => p.sessionId === 'week--1')).toBe(true);
  configurePersonalEffortPolicy({ ...DEFAULT_PERSONAL_EFFORT_POLICY, workingSetEfforts: ['rir_0'] });
  const filtered = await loadRmCurve(query);
  expect(filtered?.observations).toHaveLength(wave.scenarios.plateau.filter(row => row.rir === 0).length);
  expect(filtered?.observations.every(row => row.rir === 0)).toBe(true);
  expect(filtered?.reference.totalRm).toBeNull();
});

it('refreshes mounted reads from existing write/catalog/bodyweight signals and explicit scope revisions', async () => {
  seed(); const hook = renderHook(() => useRmCurve({ ...query, accountRevision: 0 }));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  mockFixture.database.update(exerciseSets).set({ weightValue: '0' }).where(eq(exerciseSets.id, 'week-24:1')).run();
  act(() => notifyLocalWrite());
  await waitFor(() => expect(hook.result.current.data?.observations.find(p => p.setId === 'week-24:1')?.loadKg).toBe(0));
  mockFixture.database.update(exerciseDefinitions).set({ name: 'Updated' }).run();
  act(() => invalidateExerciseCatalogCache());
  await waitFor(() => expect(hook.result.current.data?.definition.name).toBe('Updated'));
  mockFixture.database.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  mockFixture.database.update(exerciseDefinitions).set({ bodyweightContribution: 1 }).run();
  mockFixture.database.insert(bodyWeightMeasurements).values({ id: 'reading', measuredAt: new Date(2025, 0, 1), weightKg: 80 }).run();
  act(() => invalidateBodyWeightContext());
  await waitFor(() => expect(hook.result.current.data?.observations.find(p => p.setId === 'week-24:1')?.loadKg).toBe(80));
  hook.unmount();
});

it('bounds the database read by the independently anchored prior interval and rejects invalid windows', async () => {
  const read = jest.fn().mockResolvedValue(null); const load = createRmCurveRepository(read);
  expect(await load(query)).toBeNull();
  expect(read.mock.calls[0][0].start.getTime()).toBeLessThan(start.getTime());
  expect(read.mock.calls[0][0].end).toEqual(query.end);
  await expect(loadRmCurveGraph({ ...query, start: query.end })).rejects.toThrow();
  expect(await loadRmCurveGraph({ ...query, exerciseDefinitionId: '' })).toBeNull();
});
