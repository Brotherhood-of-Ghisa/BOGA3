import type { LocalDatabase } from '@/src/data/bootstrap';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '@/src/data/schema';
import { generatedMigrationBundle } from '@/drizzle/migrations.generated';
import { saveBodyWeightReading } from '@/src/data/bodyweight';
import { applyPullPage, entityToWire } from '@/src/sync/cycle';
import { reviewLegacyLoad } from '@/src/bodyweight/legacy-load';
import { validateExerciseLoadRules, BODYWEIGHT_SEED_RULES } from '@/src/exercise-core/load-rules';
import { applyLegacyLoadReview, listLegacyLoads, previewLegacyLoads } from '@/src/data/legacy-load-review';
import { exerciseDefinitions, exerciseSets, sessionExercises, sessions, bodyWeightMeasurements, syncRuntimeState } from '@/src/data/schema';
import { runBundleMigrations } from '@/src/data/bundle-migrations';
import { seedSystemExerciseCatalog, SYSTEM_EXERCISE_DEFINITION_SEEDS } from '@/src/data/exercise-catalog-seeds';
import { saveExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { loadSessionExerciseDraft, saveSessionExerciseDraft } from '@/src/session-recorder/session-exercise-draft';
import { __resetClockForTests, type Transaction } from '@/src/data/clock';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
jest.mock('@/src/logging/logEvent', () => ({ logEvent: jest.fn() }));
const context = { bodyweightCoefficient: 1, bodyWeightKg: 80, loadInputMode: 'total_load' };
const original = { weightValue: '100', repsValue: '8' };

beforeEach(() => { __resetClockForTests(); mockFixture = createInMemoryDatabase(); });
afterEach(() => mockFixture.close());

it('requires finite percentages and explicit movement and loading descriptions', () => {
  for (const coefficient of [-1, 1.01, NaN, Infinity]) {
    expect(validateExerciseLoadRules({ bodyweightCoefficient: coefficient, movementStandard: 'Pull-up', loadingMethod: 'Belt' }).ok).toBe(false);
  }
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null }).ok).toBe(true);
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 1, movementStandard: ' ', loadingMethod: 'Belt' }).ok).toBe(false);
  expect(validateExerciseLoadRules({ bodyweightCoefficient: 1, movementStandard: 'Pull-up', loadingMethod: '' }).ok).toBe(false);
  expect(Object.keys(BODYWEIGHT_SEED_RULES).sort()).toEqual(['seed_chin-ups', 'seed_parallel_bar_dips', 'seed_pull_up', 'seed_push_up']);
});

it('keeps external values literal and converts reviewed total resistance in total space', () => {
  expect(reviewLegacyLoad(original, context, { interpretation: 'added', unit: 'kg' })).toMatchObject({ weightValue: '100', resistanceKg: 180 });
  expect(reviewLegacyLoad(original, context, { interpretation: 'total', unit: 'kg' })).toEqual({ weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added', resistanceKg: 100 });
  expect(reviewLegacyLoad(original, { ...context, loadInputMode: 'per_side_load' }, { interpretation: 'total', unit: 'kg' })).toMatchObject({ weightValue: '10', resistanceKg: 100 });
  expect(reviewLegacyLoad({ ...original, weightValue: '60' }, context, { interpretation: 'total', unit: 'kg' })).toMatchObject({ weightValue: '20', externalLoadMode: 'assistance', resistanceKg: 60 });
  const pounds = reviewLegacyLoad({ ...original, weightValue: '220' }, context, { interpretation: 'total', unit: 'lb' });
  expect(pounds.weightUnit).toBe('lb');
  expect(pounds.resistanceKg).toBeCloseTo(220 * 0.45359237, 12);
});

it('requires context for total conversion, leaves missing-B external loads unavailable and never invents band mass', () => {
  expect(() => reviewLegacyLoad(original, { ...context, bodyWeightKg: null }, { interpretation: 'total', unit: 'kg' })).toThrow('session');
  expect(() => reviewLegacyLoad(original, context, { interpretation: 'added', unit: null as never })).toThrow('kg or lb');
  expect(() => reviewLegacyLoad(original, context, { interpretation: 'assistance', unit: 'kg' })).toThrow('invalid resistance');
  expect(reviewLegacyLoad(original, { ...context, bodyWeightKg: null }, { interpretation: 'added', unit: 'kg' }).resistanceKg).toBeNull();
  expect(reviewLegacyLoad(original, context, { interpretation: 'unquantified_assistance', unit: 'kg' })).toMatchObject({ weightValue: '100', resistanceKg: null });
  expect(reviewLegacyLoad({ ...original, weightValue: '0' }, context, { interpretation: 'added', unit: 'kg' }).resistanceKg).toBe(80);
  expect(reviewLegacyLoad({ ...original, weightValue: '' }, context, { interpretation: 'total', unit: 'kg' })).toMatchObject({ weightValue: '80', externalLoadMode: 'assistance', resistanceKg: 0 });
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
const preview = async () => previewLegacyLoads(await listLegacyLoads('pull'), [
  { key: 'set:actual', choice: { interpretation: 'total', unit: 'kg' } },
  { key: 'set:planned', choice: { interpretation: 'assistance', unit: 'kg' } },
]);

it('previews originals without writes; atomically reviews actual/planned meaning without confirming a set', async () => {
  const db = seed();
  const before = db.select().from(exerciseSets).get();
  const proposal = await preview();
  expect(proposal.rows[0].original.weightValue).toBe('100');
  expect(db.select().from(exerciseSets).get()).toEqual(before);
  // Rendered values cannot redirect a repository write.
  proposal.rows[0].reviewed.weightValue = '999';
  expect(await applyLegacyLoadReview(proposal)).toBe(2);
  expect(db.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', externalLoadMode: 'added',
    plannedWeightValue: '60', plannedExternalLoadMode: 'assistance', plannedWeightUnit: 'kg',
    performanceStatus: null, localDirty: true, localBodyweightMetadataKnown: true });
  await expect(applyLegacyLoadReview(proposal)).rejects.toThrow('changed');
  expect((await listLegacyLoads('pull')).candidates).toHaveLength(0);
});

it.each(['session', 'rules', 'set', 'membership'] as const)('rejects a stale %s preview with no conversion writes', async change => {
  const db = seed();
  const proposal = await preview();
  if (change === 'session') db.update(bodyWeightMeasurements).set({ weightKg: 82, weightValue: '82' }).where(eq(bodyWeightMeasurements.id, 'reading')).run();
  if (change === 'rules') db.update(exerciseDefinitions).set({ bodyweightCoefficient: 0.7 }).where(eq(exerciseDefinitions.id, 'pull')).run();
  if (change === 'set') db.update(exerciseSets).set({ repsValue: '9' }).where(eq(exerciseSets.id, 'set')).run();
  if (change === 'membership') db.insert(exerciseSets).values({ id: 'new', sessionExerciseId: 'exercise', orderIndex: 1, weightValue: '0', repsValue: '5' }).run();
  await expect(applyLegacyLoadReview(proposal)).rejects.toThrow('changed');
  expect(db.select().from(exerciseSets).where(eq(exerciseSets.id, 'set')).get()).toMatchObject({ weightValue: '100', externalLoadMode: null, localDirty: false });
});

it('blocks partial unknown metadata review and keeps zero legacy values unresolved until fully reviewed', async () => {
  const db = seed();
  db.update(exerciseSets).set({ weightValue: '0', localBodyweightMetadataKnown: false }).run();
  const inventory = await listLegacyLoads('pull');
  expect(inventory.candidates.map(row => row.key)).toContain('set:actual');
  expect(() => previewLegacyLoads(inventory, [{ key: 'set:actual', choice: { interpretation: 'added', unit: 'kg' } }])).toThrow('both actual and planned');
});

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


it('explicitly reviews an unknown actual/planned tuple with independent meanings and units offline', async () => {
  const db = seed();
  db.update(exerciseSets).set({ localBodyweightMetadataKnown: false }).run();
  const inventory = await listLegacyLoads('pull');
  const proposal = previewLegacyLoads(inventory, [
    { key: 'set:actual', choice: { interpretation: 'total', unit: 'kg' } },
    { key: 'set:planned', choice: { interpretation: 'assistance', unit: 'lb' } },
  ]);
  expect(db.select().from(exerciseSets).get()).toMatchObject({ weightValue: '100', localBodyweightMetadataKnown: false });
  await applyLegacyLoadReview(proposal);
  expect(db.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added',
    plannedWeightValue: '60', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance', localBodyweightMetadataKnown: true,
    localDirty: true, performanceStatus: null });
});

it('refuses an offline review after concurrent metadata hydration', async () => {
  const db = seed();
  db.update(exerciseSets).set({ localBodyweightMetadataKnown: false }).run();
  const proposal = await preview();
  db.update(exerciseSets).set({ localBodyweightMetadataKnown: true, weightUnit: 'lb', externalLoadMode: 'assistance' }).run();
  await expect(applyLegacyLoadReview(proposal)).rejects.toThrow('changed');
  expect(db.select().from(exerciseSets).get()).toMatchObject({ weightValue: '100', weightUnit: 'lb', externalLoadMode: 'assistance' });
});

it('restores an explicitly reviewed conventional tuple without B and clears an empty counterpart', async () => {
  const db = seed();
  db.update(exerciseDefinitions).set({ bodyweightCoefficient: 0 }).run();
  db.delete(bodyWeightMeasurements).run();
  db.update(exerciseSets).set({ localBodyweightMetadataKnown: false, plannedWeightValue: null, plannedRepsValue: null,
    plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance' }).run();
  const proposal = previewLegacyLoads(await listLegacyLoads('pull'), [
    { key: 'set:actual', choice: { interpretation: 'added', unit: 'lb' } },
  ]);
  expect(proposal.rows[0].reviewed.resistanceKg).toBeCloseTo(45.359237);
  await applyLegacyLoadReview(proposal);
  expect(db.select().from(exerciseSets).get()).toMatchObject({ weightValue: '100', weightUnit: 'lb', externalLoadMode: 'added',
    plannedWeightUnit: null, plannedExternalLoadMode: null, localBodyweightMetadataKnown: true });
  // Known conventional null-mode sets are already unambiguous and need no legacy review.
  db.update(exerciseSets).set({ externalLoadMode: null }).run();
  expect((await listLegacyLoads('pull')).candidates).toEqual([]);
});


it('reviews conventional totals without depending on even malformed irrelevant B', () => {
  for (const bodyWeightKg of [null, NaN, -1]) {
    expect(reviewLegacyLoad(original, { ...context, bodyweightCoefficient: 0, bodyWeightKg },
      { interpretation: 'total', unit: 'kg' })).toMatchObject({ weightValue: '100', resistanceKg: 100 });
  }
});

it('upgrades a populated old database, reviews it offline, and serializes only the explicitly established tuples', async () => {
  // Run the real pre-M27 schema and both upgrade migrations, not flags seeded
  // into an already-upgraded schema. No remote bootstrap/cursor can prove that
  // these rows have never synced; only the user's complete review is authority.
  mockFixture.close();
  const client = new Database(':memory:');
  const db = drizzle(client, { schema });
  mockFixture = { client, database: db, close: () => client.close() };
  const applyMigration = (idx: number) => {
    const sql = (generatedMigrationBundle.migrations as Record<string, string>)[`m${String(idx).padStart(4, '0')}`];
    for (const statement of sql.split('--> statement-breakpoint')) if (statement.trim()) client.exec(statement);
  };
  client.pragma('foreign_keys = ON');
  for (let idx = 0; idx < 7; idx++) applyMigration(idx);
  client.exec(`
    INSERT INTO muscle_groups (id,display_name,family_name) VALUES ('lats','Lats','Back');
    INSERT INTO exercise_definitions (id,name) VALUES ('pull','Old pull-up');
    INSERT INTO sessions (id,status,started_at) VALUES ('session','active',1000);
    INSERT INTO session_exercises (id,session_id,exercise_definition_id,name,order_index)
      VALUES ('exercise','session','pull','Old pull-up',0);
    INSERT INTO exercise_sets (id,session_exercise_id,order_index,weight_value,reps_value,
      planned_weight_value,planned_reps_value,performance_status)
      VALUES ('set','exercise',0,'100','8','60','10','unperformed');
  `);
  client.transaction(() => { applyMigration(7); applyMigration(8); applyMigration(9); })();
  const before = db.select().from(exerciseSets).get()!;
  expect(before.localBodyweightMetadataKnown).toBe(false);
  expect(entityToWire(before, 'exercise_sets').fields).not.toHaveProperty('weight_unit');
  expect(entityToWire(db.select().from(exerciseDefinitions).get()!, 'exercise_definitions').fields)
    .not.toHaveProperty('bodyweight_coefficient');
  expect(entityToWire(db.select().from(sessions).get()!, 'sessions').fields).not.toHaveProperty('body_weight_kg');

  await saveExerciseCatalogExercise({ id: 'pull', name: 'Old pull-up', loadInputMode: 'total_load',
    loadRules: { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' },
    mappings: [{ muscleGroupId: 'lats', weight: 1, role: 'primary' }] });
  await saveBodyWeightReading({ weightValue: '80', weightUnit: 'kg', measuredAt: new Date(1000) });
  const inventory = await listLegacyLoads('pull');
  const proposal = previewLegacyLoads(inventory, [
    { key: 'set:actual', choice: { interpretation: 'total', unit: 'kg' } },
    { key: 'set:planned', choice: { interpretation: 'assistance', unit: 'lb' } },
  ]);
  expect(db.select().from(exerciseSets).get()).toEqual(before);
  await applyLegacyLoadReview(proposal);
  expect(db.select().from(exerciseSets).get()).toMatchObject({ performanceStatus: 'unperformed',
    weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added',
    plannedWeightValue: '60', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance',
    localBodyweightMetadataKnown: true, localDirty: true });

  const loaded = await loadSessionExerciseDraft('session', 'exercise');
  if (loaded.status !== 'ready') throw new Error('Upgraded draft must be ready');
  await saveSessionExerciseDraft('session', { sessionExerciseId: 'exercise', sessionStatus: 'active',
    exercise: { ...loaded.exercise, sets: loaded.exercise.sets.map(set => ({ ...set, repsValue: '9' })) } });
  const definitionWire = entityToWire(db.select().from(exerciseDefinitions).get()!, 'exercise_definitions');
  const sessionWire = entityToWire(db.select().from(sessions).get()!, 'sessions');
  const blockWire = entityToWire(db.select().from(sessionExercises).get()!, 'session_exercises');
  const setWire = entityToWire(db.select().from(exerciseSets).get()!, 'exercise_sets');
  expect(setWire.fields).toMatchObject({ weight_value: '20', reps_value: '9', weight_unit: 'kg', external_load_mode: 'added',
    planned_weight_value: '60', planned_weight_unit: 'lb', planned_external_load_mode: 'assistance', performance_status: 'unperformed' });
  expect(sessionWire.fields).not.toHaveProperty('body_weight_kg');
  const readingWire = entityToWire(db.select().from(bodyWeightMeasurements).get()!, 'body_weight_measurements');
  expect(definitionWire.fields.bodyweight_coefficient).toBe(1);
  expect(client.pragma('foreign_key_check')).toEqual([]);

  mockFixture.close(); mockFixture = createInMemoryDatabase();
  mockFixture.database.transaction(tx => {
    applyPullPage(tx as Transaction, [readingWire], 'body_weight_measurements');
    applyPullPage(tx as Transaction, [definitionWire], 'exercise_definitions');
    applyPullPage(tx as Transaction, [sessionWire], 'sessions');
    applyPullPage(tx as Transaction, [blockWire], 'session_exercises');
    applyPullPage(tx as Transaction, [setWire], 'exercise_sets');
  });
  expect(mockFixture.database.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', repsValue: '9',
    weightUnit: 'kg', externalLoadMode: 'added', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance',
    localBodyweightMetadataKnown: true, performanceStatus: 'unperformed' });
  expect(mockFixture.database.select().from(bodyWeightMeasurements).get()).toMatchObject({ weightKg: 80 });
});
