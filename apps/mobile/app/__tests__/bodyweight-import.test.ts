import { BOGA_SESSION_IMPORT_SCHEMA_V2, serializeBogaSessionImportPackage, validateBogaSessionImportPackage,
  type BogaSessionImportPackage } from '../../scripts/import/boga-import-contract';
import { importBogaSessionPackageToLocalDb } from '../../scripts/import/import-boga-json-local';
import { buildRemoteImportWireEntities } from '../../scripts/import/import-boga-json-remote';
import { generatedSessionId } from '../../scripts/import/boga-import-ids';
import { __resetClockForTests } from '@/src/data/clock';
import { bodyWeightMeasurements, exerciseDefinitions, exerciseSets, muscleGroups, sessions } from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

const makePackage = (): BogaSessionImportPackage => ({
  schema: BOGA_SESSION_IMPORT_SCHEMA_V2, generatedAt: '2026-09-01T12:00:00.000Z',
  target: { importingProfileLabel: 'test', catalogSnapshot: { exercises: [], gyms: [] } },
  source: { app: 'BOGA', exportFile: { sha256: 'source' }, timezone: 'UTC', rowCount: 1, skippedRowCount: 0 },
  options: { sessionClusterGapMinutes: 90, shortSessionThresholdMinutes: 30, shortSessionDefaultDurationMinutes: 60,
    longSessionWarningThresholdMinutes: 90, gymAssignments: { midday: null, weekdayEvening: null, weekend: null } },
  bodyWeightMeasurements: [{ id: 'reading', weightValue: '180', weightUnit: 'lb', weightKg: 180 * 0.45359237,
    measuredAt: '2026-01-05T12:00:00.000Z' }],
  exerciseDecisions: [{ decision: 'create_new', sourceExerciseName: 'Pull-up', exerciseName: 'Pull-up', importExerciseKey: 'pull',
    loadInputMode: 'per_side_load', loadRules: { bodyweightCoefficient: 1, movementStandard: 'Strict pull-up', loadingMethod: 'Belt' },
    muscleMappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }], warnings: [] }],
  sessions: [{ importSessionKey: 'session', localDate: '2026-01-01', startedAt: '2026-01-01T12:00:00.000Z',
    completedAt: '2026-01-01T13:00:00.000Z', durationSec: 3600, rawSpanSec: 3600, gymId: null, gymBucket: 'none',
    sourceWorkoutNames: [], warnings: [], bodyWeightKg: 80, bodyWeightSource: 'historical_estimate',
    bodyWeightMeasurementId: 'reading', bodyWeightMeasuredAt: '2026-01-05T12:00:00.000Z',
    exercises: [{ orderIndex: 0, sourceExerciseName: 'Pull-up', targetExercise: { kind: 'create', importExerciseKey: 'pull', exerciseName: 'Pull-up' },
      sets: [{ orderIndex: 0, weightValue: '20', weightUnit: 'lb', externalLoadMode: 'added', repsValue: '8', setType: 'rir_1',
        plannedWeightValue: '40', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'assistance', plannedRepsValue: '10', plannedSetType: 'rir_2',
        performanceStatus: 'unperformed', warnings: [], source: { rowIndex: 1, workoutName: 'Workout', exerciseName: 'Pull-up',
          loggedAtLocal: '2026-01-01 12:00:00', type: '', targetRegion: '', targetMusclesPrimary: '', targetMusclesSecondary: '' } }] }] }],
  report: { counts: { sourceRows: 1, skippedRows: 0, importedRows: 1, inferredSessions: 1, notesPreserved: 0,
    unresolvedExercises: 0, durationWarnings: 0 }, unresolvedExercises: [], gymAssignmentCounts: {}, notes: [], warnings: [] },
});

let fixture: InMemoryDatabaseFixture;
beforeEach(() => { __resetClockForTests(); fixture = createInMemoryDatabase();
  fixture.database.insert(muscleGroups).values({ id: 'back_lats', displayName: 'Lats', familyName: 'Back', sortOrder: 0, isEditable: 0 }).run(); });
afterEach(() => fixture.close());

it('exports v3 and imports without losing private readings, raw units, planned modes or confirmation state', () => {
  const pkg = JSON.parse(serializeBogaSessionImportPackage(makePackage())) as BogaSessionImportPackage;
  expect(validateBogaSessionImportPackage(pkg)).toEqual({ ok: true, errors: [] });
  const options = { importingProfileLabel: 'test' };
  const result = importBogaSessionPackageToLocalDb(fixture.database, pkg, options);
  expect(result.validation.errors).toEqual([]);
  expect(result.wrote).toBe(true);
  const reading = fixture.database.select().from(bodyWeightMeasurements).get()!;
  expect(reading).toMatchObject({ weightValue: '180', weightUnit: 'lb', weightKg: 180 * 0.45359237, localDirty: true });
  expect(pkg.schema).toBe('boga.session-import.v3');
  expect(pkg.sessions[0]).not.toHaveProperty('bodyWeightKg');
  expect(fixture.database.select().from(sessions).get()).not.toHaveProperty('bodyWeightKg');
  expect(fixture.database.select().from(exerciseDefinitions).get()).toMatchObject({ bodyweightCoefficient: 1, loadInputMode: 'per_side_load',
    movementStandard: 'Strict pull-up', loadingMethod: 'Belt' });
  expect(fixture.database.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20', weightUnit: 'lb', externalLoadMode: 'added',
    plannedWeightValue: '40', plannedWeightUnit: 'lb', plannedExternalLoadMode: 'added', performanceStatus: 'unperformed' });
  const repeated = importBogaSessionPackageToLocalDb(fixture.database, pkg, options);
  expect(repeated.report.counts).toMatchObject({ sessionsInserted: 0, bodyWeightMeasurementsInserted: 0, exerciseSetsInserted: 0 });
});

it('emits matching owner-scoped sync entities with explicit new metadata', () => {
  const entities = buildRemoteImportWireEntities(makePackage());
  const reading = entities.find(entity => entity.type === 'body_weight_measurements')!;
  expect(reading.fields).toMatchObject({ weight_value: '180', weight_unit: 'lb', weight_kg: 180 * 0.45359237 });
  expect(entities.find(entity => entity.type === 'sessions')?.fields).not.toHaveProperty('body_weight_kg');
  expect(entities.find(entity => entity.type === 'exercise_sets')?.fields).toMatchObject({ weight_unit: 'lb', external_load_mode: 'added',
    planned_weight_unit: 'lb', planned_external_load_mode: 'added', performance_status: 'unperformed' });
});

const legacyPackage = () => {
  const pkg = makePackage();
  pkg.schema = 'boga.session-import.v1'; delete pkg.bodyWeightMeasurements;
  for (const decision of pkg.exerciseDecisions) if (decision.decision === 'create_new') { delete decision.loadRules; delete decision.loadInputMode; }
  for (const session of pkg.sessions) {
    delete session.bodyWeightKg; delete session.bodyWeightSource; delete session.bodyWeightMeasurementId; delete session.bodyWeightMeasuredAt;
    for (const exercise of session.exercises) for (const set of exercise.sets) {
      delete set.weightUnit; delete set.externalLoadMode; delete set.plannedWeightValue; delete set.plannedWeightUnit;
      delete set.plannedExternalLoadMode; delete set.plannedRepsValue; delete set.plannedSetType; delete set.performanceStatus;
    }
  }
  return pkg;
};

it('keeps v1 loads unresolved and omitted on the wire; schema upgrades keep import identity stable', () => {
  const old = legacyPackage(); const next = makePackage();
  expect(generatedSessionId(old, old.sessions[0])).toBe(generatedSessionId(next, next.sessions[0]));
  expect(importBogaSessionPackageToLocalDb(fixture.database, old, { importingProfileLabel: 'test' }).wrote).toBe(true);
  expect(fixture.database.select().from(exerciseSets).get()).toMatchObject({ weightUnit: 'kg', externalLoadMode: null });
  expect(fixture.database.select().from(bodyWeightMeasurements).all()).toEqual([]);
  const wire = buildRemoteImportWireEntities(old);
  expect(wire.find(entity => entity.type === 'exercise_sets')?.fields).not.toHaveProperty('external_load_mode');
  expect(wire.find(entity => entity.type === 'sessions')?.fields).not.toHaveProperty('body_weight_kg');
});

it('rejects invalid, partial, future and silently downgraded context before writing', () => {
  const pkg = makePackage();
  pkg.bodyWeightMeasurements![0].weightKg = 999;
  pkg.sessions[0].bodyWeightMeasurementId = null;
  pkg.sessions[0].exercises[0].sets[0].weightUnit = 'stone' as never;
  expect(validateBogaSessionImportPackage(pkg).ok).toBe(false);
  expect(() => buildRemoteImportWireEntities(pkg)).toThrow();
  const future = makePackage(); future.bodyWeightMeasurements![0].measuredAt = '2999-01-01T12:00:00.000Z';
  expect(validateBogaSessionImportPackage(future).errors.join(' ')).toContain('later');
  const downgrade = makePackage(); downgrade.schema = 'boga.session-import.v1';
  expect(validateBogaSessionImportPackage(downgrade).ok).toBe(false);
  expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
});


it.each([null, {}, [null], [{ id: 'bad' }]])('reports malformed reading collections without partial local writes (%j)', value => {
  const pkg = makePackage(); pkg.bodyWeightMeasurements = value as never;
  const result = importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' });
  expect(result.validation.ok).toBe(false);
  expect(result.wrote).toBe(false);
  expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
  expect(fixture.database.select().from(bodyWeightMeasurements).all()).toHaveLength(0);
});


it('ignores even malformed legacy session-only weight without manufacturing readings', () => {
  const pkg = makePackage(); pkg.bodyWeightMeasurements = [];
  Object.assign(pkg.sessions[0], { bodyWeightKg: 'bad', bodyWeightSource: 'manual', bodyWeightMeasuredAt: 'bad' });
  expect(validateBogaSessionImportPackage(pkg)).toEqual({ ok: true, errors: [] });
  expect(importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' }).wrote).toBe(true);
  expect(fixture.database.select().from(bodyWeightMeasurements).all()).toEqual([]);
  expect(fixture.database.select().from(sessions).get()).not.toHaveProperty('bodyWeightKg');
  expect(buildRemoteImportWireEntities(pkg).some(row => row.type === 'body_weight_measurements')).toBe(false);
});

it('rejects stored session-weight fields in a v3 package', () => {
  const pkg = makePackage(); pkg.schema = 'boga.session-import.v3';
  expect(validateBogaSessionImportPackage(pkg).ok).toBe(false);
  expect(importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' }).wrote).toBe(false);
});
