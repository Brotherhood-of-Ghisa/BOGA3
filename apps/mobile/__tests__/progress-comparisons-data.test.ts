import { eq } from 'drizzle-orm';
import { computeProgressComparisons, computeStatsSummary } from '@/src/data/stats';
import { exerciseDefinitions, exerciseMuscleMappings, exerciseSets, muscleGroups, sessionExercises,
  sessions, bodyWeightMeasurements, userSettings } from '@/src/data/schema';
import { ensureAccountLocalPreferencesLoaded, setAccountLocalPreferenceAccount, setAccountLocalPreferences,
  __resetAccountLocalPreferencesForTests } from '@/src/preferences/account-local';
import { DEFAULT_PERSONAL_EFFORT_POLICY, type EffortCalculationPolicy } from '@/src/exercise-calculations/effort-policy';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));

const now = new Date('2026-05-21T12:00:00Z');
const options = { periodWeeks: 1, now };
const account = async (id = 'A') => {
  setAccountLocalPreferenceAccount(id, true);
  await ensureAccountLocalPreferencesLoaded();
};

beforeEach(async () => {
  mockFixture = createInMemoryDatabase();
  await account();
  const db = mockFixture.database;
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: false }).run();
  db.insert(muscleGroups).values([
    { id: 'back', displayName: 'Back', familyName: 'Back', sortOrder: 10 },
    { id: 'empty', displayName: 'Empty', familyName: 'Legs', sortOrder: 20 },
  ]).run();
  db.insert(exerciseDefinitions).values([
    { id: 'lift', name: 'Lift', loadInputMode: 'per_side_load', bodyweightContribution: 1 },
    { id: 'volume-only', name: 'Volume only', loadInputMode: 'total_load' },
    { id: 'previous-only', name: 'Previous only', loadInputMode: 'per_side_load' },
  ]).run();
  db.insert(exerciseMuscleMappings).values([
    { id: 'map', exerciseDefinitionId: 'lift', muscleGroupId: 'back', role: 'secondary', weight: 0.5 },
    { id: 'vol-map', exerciseDefinitionId: 'volume-only', muscleGroupId: 'back', role: 'primary', weight: 1 },
    { id: 'old-map', exerciseDefinitionId: 'previous-only', muscleGroupId: 'back', role: 'primary', weight: 1 },
  ]).run();
  for (const [id, date] of [['now', '2026-05-20T10:00:00Z'], ['prev', '2026-05-13T10:00:00Z']]) {
    const startedAt = new Date(date);
    db.insert(sessions).values({ id, status: 'completed', startedAt, completedAt: startedAt }).run();
    db.insert(sessionExercises).values({ id: `${id}-block`, sessionId: id, exerciseDefinitionId: 'lift', name: 'Old lift name', orderIndex: 0 }).run();
    db.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: `${id}-block`, orderIndex: 0,
      weightValue: '40', repsValue: '5', setType: 'rir_2', performanceStatus: null }).run();
  }
  db.insert(sessionExercises).values([
    { id: 'repeat', sessionId: 'now', exerciseDefinitionId: 'lift', name: 'Lift', orderIndex: 1 },
    { id: 'vol', sessionId: 'now', exerciseDefinitionId: 'volume-only', name: 'Volume only', orderIndex: 2 },
    { id: 'old', sessionId: 'prev', exerciseDefinitionId: 'previous-only', name: 'Previous only', orderIndex: 1 },
    { id: 'unlinked', sessionId: 'now', exerciseDefinitionId: null, name: 'Lift', orderIndex: 3 },
  ]).run();
  db.insert(exerciseSets).values([
    { id: 'repeat-set', sessionExerciseId: 'repeat', orderIndex: 0, weightValue: '40', repsValue: '5', setType: 'rir_2' },
    { id: 'working-only', sessionExerciseId: 'repeat', orderIndex: 1, weightValue: '20', repsValue: '5', setType: 'technique' },
    { id: 'volume-set', sessionExerciseId: 'vol', orderIndex: 0, weightValue: '80', repsValue: '5', setType: 'warm_up' },
    { id: 'previous-set', sessionExerciseId: 'old', orderIndex: 0, weightValue: '0', repsValue: '5', setType: 'rir_2' },
    { id: 'planned', sessionExerciseId: 'repeat', orderIndex: 2, weightValue: '999', repsValue: '5', setType: 'rir_2', performanceStatus: 'planned' },
    { id: 'unperformed', sessionExerciseId: 'repeat', orderIndex: 3, weightValue: '999', repsValue: '5', setType: 'rir_2', performanceStatus: 'unperformed' },
    { id: 'unlinked-set', sessionExerciseId: 'unlinked', orderIndex: 0, weightValue: '999', repsValue: '5', setType: 'rir_2' },
  ]).run();
  db.insert(bodyWeightMeasurements).values({ id: 'reading', weightKg: 80, measuredAt: new Date('2026-05-10T10:00:00Z') }).run();
});
afterEach(() => mockFixture.close());

const readAndReconcile = async () => {
  const result = await computeProgressComparisons(options);
  const oracle = await computeStatsSummary(options);
  expect(result.current).toEqual(oracle.current);
  expect(result.previous).toEqual(oracle.previous);
  for (const period of ['current', 'previous'] as const) {
    for (const muscle of result.muscles) {
      const summary = oracle[period].totals.muscleFamilies.flatMap(family => family.muscles).find(row => row.muscleGroupId === muscle.muscleGroupId)!;
      expect(muscle[period]).toMatchObject({ workingSetCount: summary.workingSetCount,
        totalVolume: summary.totalVolume });
      expect(muscle.exercises.reduce((sum, row) => sum + row[period].workingSetCount, 0)).toBe(muscle[period].workingSetCount);
      expect(muscle.exercises.reduce((sum, row) => sum + row.workingSetChange, 0)).toBe(muscle.workingSetChange);
      if (muscle[period].totalVolume !== null) {
        expect(muscle.exercises.reduce((sum, row) => sum + row[period].totalVolume!, 0)).toBeCloseTo(muscle[period].totalVolume!);
      }
    }
  }
  return result.muscles[0];
};

it('reads migrated SQLite with repeated blocks, previous-only zero-load rows and no identity joins by name', async () => {
  const row = await readAndReconcile();
  expect(row).toMatchObject({ current: { workingSetCount: 2, totalVolume: 200 },
    previous: { workingSetCount: 2, totalVolume: 100 }, workingSetChange: 0, volumeChange: { kind: 'percent', percent: 100 } });
  expect(row.exercises.map(exercise => exercise.exerciseDefinitionId)).toEqual(['lift', 'previous-only']);
  expect(row.exercises[0]).toMatchObject({ displayName: 'Lift', role: 'secondary', current: { workingSetCount: 2 } });
  expect(row.exercises[1]).toMatchObject({ current: { workingSetCount: 0, volumeSetCount: 0 },
    previous: { workingSetCount: 1, totalVolume: 0, volumeSetCount: 1 } });
  expect((await computeProgressComparisons(options)).muscles[1].exercises).toEqual([]);
});

it.each([
  ['default', DEFAULT_PERSONAL_EFFORT_POLICY, 2, 200, 2],
  ['included warm-up', { workingSetEfforts: ['warm_up'], volumeEfforts: ['warm_up'] }, 1, 200, 1],
  ['excluded RIR and independent columns', { workingSetEfforts: ['technique'], volumeEfforts: ['warm_up'] }, 1, 200, 1],
  ['empty Working set column', { workingSetEfforts: [], volumeEfforts: ['warm_up'] }, 0, 200, 1],
  ['empty Volume column', { workingSetEfforts: ['technique'], volumeEfforts: [] }, 1, 0, 0],
  ['both calculation columns empty', { workingSetEfforts: [], volumeEfforts: [] }, 0, 0, 0],
] as [string, EffortCalculationPolicy, number, number, number][])(
  'uses durable %s choices independently of Display on refresh', async (_name, policy, workingSetCount, totalVolume, volumeSetCount) => {
    await readAndReconcile();
    setAccountLocalPreferences({ workingSetEfforts: [...policy.workingSetEfforts],
      volumeEfforts: [...policy.volumeEfforts], displayEfforts: ['rir_0'] });
    const row = await readAndReconcile();
    expect(row.current).toMatchObject({ workingSetCount, totalVolume, volumeSetCount });
    if (volumeSetCount === 1) expect(row.exercises.find(exercise => exercise.exerciseDefinitionId === 'volume-only')?.current.volumeSetCount).toBe(1);
  });

it('refreshes both periods after edits, mapping reinterpretation, tombstones and bodyweight changes', async () => {
  await readAndReconcile();
  const db = mockFixture.database;
  db.update(exerciseSets).set({ weightValue: '60' }).where(eq(exerciseSets.id, 'now-set')).run();
  expect((await readAndReconcile()).current.totalVolume).toBe(250);
  db.update(exerciseMuscleMappings).set({ role: 'primary' }).where(eq(exerciseMuscleMappings.id, 'map')).run();
  expect(await readAndReconcile()).toMatchObject({ current: { totalVolume: 500 }, previous: { totalVolume: 200 } });
  db.update(userSettings).set({ bodyweightCalculationsEnabled: true }).run();
  expect(await readAndReconcile()).toMatchObject({ current: { totalVolume: 900 }, previous: { totalVolume: 400 } });
  db.update(bodyWeightMeasurements).set({ weightKg: 82 }).run();
  expect(await readAndReconcile()).toMatchObject({ current: { totalVolume: 910 }, previous: { totalVolume: 405 } });
  db.update(exerciseSets).set({ deletedAt: now }).where(eq(exerciseSets.id, 'repeat-set')).run();
  expect((await readAndReconcile()).current).toMatchObject({ workingSetCount: 1, totalVolume: 505 });
  db.update(sessionExercises).set({ deletedAt: now }).where(eq(sessionExercises.id, 'now-block')).run();
  expect((await readAndReconcile()).current.workingSetCount).toBe(0);
  db.update(sessions).set({ deletedAt: now }).where(eq(sessions.id, 'prev')).run();
  expect((await readAndReconcile()).previous.workingSetCount).toBe(0);
});

it('leaves uncalculable sets out and keeps legitimate zero Volume under the same saved policy', async () => {
  const db = mockFixture.database;
  db.update(userSettings).set({ bodyweightCalculationsEnabled: true }).run();
  db.update(exerciseDefinitions).set({ bodyweightContribution: 2 }).where(eq(exerciseDefinitions.id, 'lift')).run();
  setAccountLocalPreferences({ volumeEfforts: [...DEFAULT_PERSONAL_EFFORT_POLICY.volumeEfforts, 'warm_up'] });
  const row = await readAndReconcile();
  expect(row.current).toMatchObject({ totalVolume: 200, volumeSetCount: 3 });
  expect(row.previous).toMatchObject({ totalVolume: 0, volumeSetCount: 2 });
  expect(row.volumeChange).toEqual({ kind: 'new' });
  db.update(exerciseSets).set({ weightValue: '' }).where(eq(exerciseSets.id, 'volume-set')).run();
  expect((await readAndReconcile()).exercises.find(exercise => exercise.exerciseDefinitionId === 'volume-only')?.current)
    .toMatchObject({ workingSetCount: 0, totalVolume: 0, volumeSetCount: 1 });
});

it('restores account-local policy on relaunch and account switches without reusing a prior result', async () => {
  setAccountLocalPreferences({ workingSetEfforts: [], volumeEfforts: ['warm_up'] });
  expect((await readAndReconcile()).current).toMatchObject({ workingSetCount: 0, totalVolume: 200 });
  __resetAccountLocalPreferencesForTests();
  await account();
  expect((await readAndReconcile()).current).toMatchObject({ workingSetCount: 0, totalVolume: 200 });
  await account('B');
  expect((await readAndReconcile()).current).toMatchObject({ workingSetCount: 2, totalVolume: 200 });
  await account('A');
  expect((await readAndReconcile()).current).toMatchObject({ workingSetCount: 0, totalVolume: 200 });
});

it('places sessions by completedAt in half-open calendar bounds, including the DST shift', async () => {
  const db = mockFixture.database;
  db.delete(sessions).run();
  const at = new Date(2026, 2, 30, 12); // BST: the previous calendar week spans the clock change.
  const boundaries = [
    ['prev-start', new Date(2026, 2, 23, 0)],
    ['prev-end', new Date(2026, 2, 23, 12)],
    ['current-start', new Date(2026, 2, 30, 0)],
    ['current-end', at],
  ] as const;
  for (const [id, completedAt] of boundaries) {
    db.insert(sessions).values({ id, status: 'completed', startedAt: new Date(2026, 2, 1), completedAt }).run();
    db.insert(sessionExercises).values({ id: `${id}-block`, sessionId: id, exerciseDefinitionId: 'lift', name: 'Lift', orderIndex: 0 }).run();
    db.insert(exerciseSets).values({ id: `${id}-set`, sessionExerciseId: `${id}-block`, orderIndex: 0, setType: 'rir_2', weightValue: '40', repsValue: '5' }).run();
  }
  const result = await computeProgressComparisons({ periodWeeks: 1, now: at });
  expect(result.current.period.start).toEqual(new Date(2026, 2, 30));
  expect(result.previous.period).toMatchObject({ start: new Date(2026, 2, 23), end: new Date(2026, 2, 23, 12) });
  expect(result.muscles[0]).toMatchObject({ current: { workingSetCount: 1, totalVolume: 100 },
    previous: { workingSetCount: 1, totalVolume: 100 } });
});
