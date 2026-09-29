import type { LocalDatabase } from '@/src/data/bootstrap';
import { eq } from 'drizzle-orm';
import { validateExerciseLoadRules, BODYWEIGHT_SEED_RULES } from '@/src/exercise-core/load-rules';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions, bodyWeightMeasurements, syncRuntimeState } from '@/src/data/schema';
import { runBundleMigrations } from '@/src/data/bundle-migrations';
import { seedSystemExerciseCatalog, SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { loadSessionExerciseDraft, saveSessionExerciseDraft } from '@/src/session-recorder/session-exercise-draft';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));
import { __resetClockForTests } from '@/src/data/clock';
import { calculateAnalyticsSetMetrics } from '@/src/exercise-calculations/analytics';
beforeEach(() => { __resetClockForTests(); mockFixture = createInMemoryDatabase(); });
afterEach(() => mockFixture.close());

it('requires a finite percentage and treats retired descriptions as optional legacy metadata', () => {
  for (const coefficient of [-1, 1.01, NaN, Infinity]) {
    expect(validateExerciseLoadRules({ bodyweightCoefficient: coefficient, movementStandard: 'Pull-up', loadingMethod: 'Belt' }).ok).toBe(false);
  }
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null }).ok).toBe(true);
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 1, movementStandard: ' ', loadingMethod: 'Belt' }))
    .toMatchObject({ ok: true, value: { movementStandard: null, loadingMethod: 'Belt' } });
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 1, movementStandard: 'Pull-up', loadingMethod: '' }))
    .toMatchObject({ ok: true, value: { movementStandard: 'Pull-up', loadingMethod: null } });
  expect(Object.keys(BODYWEIGHT_SEED_RULES).sort()).toEqual(['seed_chin-ups', 'seed_parallel_bar_dips', 'seed_pull_up', 'seed_push_up']);
});

const seed = () => {
  const db = mockFixture.database;
  db.insert(exerciseDefinitions).values({ id: 'pull', name: 'Pull-up', ...BODYWEIGHT_SEED_RULES.seed_pull_up }).run();
  db.insert(sessions).values({ id: 'session', startedAt: new Date('2026-09-01'), status: 'completed' }).run();
  db.insert(bodyWeightMeasurements).values({ id: 'reading', weightValue: '80', weightKg: 80, weightUnit: 'kg', measuredAt: new Date('2026-09-01') }).run();
  db.insert(sessionExercises).values({ id: 'exercise', sessionId: 'session', exerciseDefinitionId: 'pull', name: 'Pull-up', orderIndex: 0 }).run();
  db.insert(exerciseSets).values({ id: 'set', sessionExerciseId: 'exercise', orderIndex: 0, weightValue: '100', repsValue: '8',
    plannedWeightValue: '60', plannedRepsValue: '10', performanceStatus: null }).run();
  return db;
};
it('preserves hydrated units and meanings when an older open draft saves ordinary edits', async () => {
  const db = seed();
  db.update(sessions).set({ status: 'active' }).run();
  db.update(exerciseSets).set({ localBodyweightMetadataKnown: false }).run();
  const loaded = await loadSessionExerciseDraft('session', 'exercise');
  expect(loaded.status).toBe('ready');
  if (loaded.status !== 'ready') throw new Error('Fixture must load');
  // A sync pull hydrates metadata while the screen still holds placeholders.
  db.update(exerciseSets).set({ weightUnit: 'lb', externalLoadMode: 'assistance',
    plannedWeightUnit: 'lb', plannedExternalLoadMode: 'added', localBodyweightMetadataKnown: true }).run();
  await saveSessionExerciseDraft('session', { sessionExerciseId: 'exercise', sessionStatus: 'active',
    exercise: { ...loaded.exercise, sets: loaded.exercise.sets.map(set => ({ ...set, repsValue: '9' })) } });
  expect(db.select().from(exerciseSets).get()).toMatchObject({ repsValue: '9', weightUnit: 'lb',
    externalLoadMode: 'assistance', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'added',
    localBodyweightMetadataKnown: true });
});


it('seeds only the four reviewed fresh identities and preserves existing user changes on upgrade', () => {
  const db = mockFixture.database;
  seedSystemExerciseCatalog(db as unknown as LocalDatabase);
  const weighted = db.select().from(exerciseDefinitions).all().filter(row => row.bodyweightCoefficient > 0);
  expect(weighted.map(row => row.id).sort()).toEqual(Object.keys(BODYWEIGHT_SEED_RULES).sort());
  for (const seed of SYSTEM_EXERCISE_DEFINITION_SEEDS) {
    db.update(exerciseDefinitions).set({ bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null })
      .where(eq(exerciseDefinitions.id, seed.id)).run();
  }
  db.update(exerciseDefinitions).set({ name: 'My knee push-up' }).where(eq(exerciseDefinitions.id, 'seed_push_up')).run();
  db.update(exerciseDefinitions).set({ bodyweightCoefficient: 0.8, movementStandard: 'My strict chin-up', loadingMethod: 'Chain' })
    .where(eq(exerciseDefinitions.id, 'seed_chin-ups')).run();
  db.update(exerciseDefinitions).set({ deletedAt: new Date() }).where(eq(exerciseDefinitions.id, 'seed_parallel_bar_dips')).run();
  db.update(syncRuntimeState).set({ appliedSeedMigrationAppVersion: 2 }).run();
  runBundleMigrations(db as unknown as LocalDatabase);
  const rows = new Map(db.select().from(exerciseDefinitions).all().map(row => [row.id, row]));
  expect(rows.get('seed_pull_up')).toMatchObject(BODYWEIGHT_SEED_RULES.seed_pull_up);
  expect(rows.get('seed_push_up')?.bodyweightCoefficient).toBe(0);
  expect(rows.get('seed_chin-ups')).toMatchObject({ bodyweightCoefficient: 0.8, loadingMethod: 'Chain' });
  expect(rows.get('seed_parallel_bar_dips')?.bodyweightCoefficient).toBe(0);
  expect(rows.get('seed_parallel_bar_dips')?.deletedAt).not.toBeNull();
});

it('waits for old-reader metadata replay before advancing the seed generation', () => {
  const db = mockFixture.database;
  const seed = SYSTEM_EXERCISE_DEFINITION_SEEDS.find(row => row.id === 'seed_pull_up')!;
  db.insert(exerciseDefinitions).values({ id: seed.id, name: seed.name, localBodyweightMetadataKnown: false }).run();
  db.insert(syncRuntimeState).values({ id: 'primary', appliedSeedMigrationAppVersion: 2 }).run();
  runBundleMigrations(db as unknown as LocalDatabase);
  expect(db.select().from(syncRuntimeState).get()?.appliedSeedMigrationAppVersion).toBe(2);
  expect(db.select().from(exerciseDefinitions).get()?.bodyweightCoefficient).toBe(0);
  db.update(exerciseDefinitions).set({ localBodyweightMetadataKnown: true, bodyweightCoefficient: 0.9,
    movementStandard: 'Custom standard', loadingMethod: 'Chain' }).run();
  runBundleMigrations(db as unknown as LocalDatabase);
  expect(db.select().from(syncRuntimeState).get()?.appliedSeedMigrationAppVersion).toBe(3);
  expect(db.select().from(exerciseDefinitions).get()?.bodyweightCoefficient).toBe(0.9);
});

it('preserves omitted exercise load rules and writes an explicit complete tuple atomically', async () => {
  const db = mockFixture.database;
  seedSystemExerciseCatalog(db as unknown as LocalDatabase);
  db.update(exerciseDefinitions).set({ localBodyweightMetadataKnown: false }).where(eq(exerciseDefinitions.id, 'seed_pull_up')).run();
  const input = { id: 'seed_pull_up', name: 'Renamed pull-up', loadInputMode: 'total_load' as const,
    mappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' as const }] };
  const renamed = await saveExerciseCatalogExercise(input);
  expect(renamed).toMatchObject({ bodyweightCoefficient: 1, localBodyweightMetadataKnown: false });
  await expect(saveExerciseCatalogExercise({ ...input, loadRules: { bodyweightCoefficient: 1.1,
    movementStandard: 'Strict pull-up', loadingMethod: 'Belt' } })).rejects.toThrow('100%');
  expect(db.select().from(exerciseDefinitions).where(eq(exerciseDefinitions.id, input.id)).get()?.bodyweightCoefficient).toBe(1);
  const configured = await saveExerciseCatalogExercise({ ...input, loadRules: { bodyweightCoefficient: 0.9,
    movementStandard: ' Strict pull-up ', loadingMethod: ' Belt ' } });
  expect(configured).toMatchObject({ bodyweightCoefficient: 0.9, movementStandard: 'Strict pull-up', loadingMethod: 'Belt', localBodyweightMetadataKnown: true });
});


it.each([null, 'added', 'assistance', 'unquantified_assistance'])('uses existing numeric weight as added weight without rewriting raw rows: %s', mode => {
  const db = seed();
  db.update(exerciseSets).set({ externalLoadMode: mode, localBodyweightMetadataKnown: false }).run();
  const original = db.select().from(exerciseSets).get()!;
  const result = calculateAnalyticsSetMetrics({ ...original, performanceStatus: null, bodyweightCoefficient: 1,
    bodyWeightKg: 80, loadInputMode: 'total_load' });
  expect(result.volumeKgReps).toBe(1440);
  expect(result.estimatedOneRepMaxKg).toBeCloseTo(149.808554, 6);
  expect(db.select().from(exerciseSets).get()).toEqual(original);
});
