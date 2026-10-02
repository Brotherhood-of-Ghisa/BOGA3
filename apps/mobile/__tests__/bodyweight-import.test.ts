import {
  BOGA_SESSION_IMPORT_SCHEMA_V4,
  serializeBogaSessionImportPackage,
  validateBogaSessionImportPackage,
  type BogaSessionImportPackage,
} from '../scripts/import/boga-import-contract';
import { importBogaSessionPackageToLocalDb } from '../scripts/import/import-boga-json-local';
import { buildRemoteImportWireEntities } from '../scripts/import/import-boga-json-remote';
import { __resetClockForTests } from '@/src/data/clock';
import {
  bodyWeightMeasurements,
  exerciseDefinitions,
  exerciseSets,
  muscleGroups,
  sessions,
  userSettings,
} from '@/src/data/schema';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

const makePackage = (): BogaSessionImportPackage => ({
  schema: BOGA_SESSION_IMPORT_SCHEMA_V4,
  bodyweightCalculationsEnabled: true,
  generatedAt: '2026-09-01T12:00:00.000Z',
  target: { importingProfileLabel: 'test', catalogSnapshot: { exercises: [], gyms: [] } },
  source: { app: 'BOGA', exportFile: { sha256: 'source' }, timezone: 'UTC', rowCount: 1, skippedRowCount: 0 },
  options: { sessionClusterGapMinutes: 90, shortSessionThresholdMinutes: 30,
    shortSessionDefaultDurationMinutes: 60, longSessionWarningThresholdMinutes: 90,
    gymAssignments: { midday: null, weekdayEvening: null, weekend: null } },
  bodyWeightMeasurements: [{ id: 'reading', weightKg: 81.65, measuredAt: '2026-01-01T11:00:00.000Z' }],
  exerciseDecisions: [{ decision: 'create_new', sourceExerciseName: 'Pull-up', exerciseName: 'Pull-up',
    importExerciseKey: 'pull', loadInputMode: 'per_side_load', bodyweightContribution: 1,
    muscleMappings: [{ muscleGroupId: 'back_lats', weight: 1, role: 'primary' }], warnings: [] }],
  sessions: [{ importSessionKey: 'session', localDate: '2026-01-01', startedAt: '2026-01-01T12:00:00.000Z',
    completedAt: '2026-01-01T13:00:00.000Z', durationSec: 3600, rawSpanSec: 3600,
    gymId: null, gymBucket: 'none', sourceWorkoutNames: [], warnings: [],
    exercises: [{ orderIndex: 0, sourceExerciseName: 'Pull-up',
      targetExercise: { kind: 'create', importExerciseKey: 'pull', exerciseName: 'Pull-up' },
      sets: [{ orderIndex: 0, weightValue: '20', repsValue: '8', setType: 'rir_1',
        plannedWeightValue: '40', plannedRepsValue: '10', plannedSetType: 'rir_2',
        performanceStatus: 'unperformed', warnings: [], source: { rowIndex: 1, workoutName: 'Workout',
          exerciseName: 'Pull-up', loggedAtLocal: '2026-01-01 12:00:00', type: '', targetRegion: '',
          targetMusclesPrimary: '', targetMusclesSecondary: '' } }] }] }],
  report: { counts: { sourceRows: 1, skippedRows: 0, importedRows: 1, inferredSessions: 1,
    notesPreserved: 0, unresolvedExercises: 0, durationWarnings: 0 }, unresolvedExercises: [],
    gymAssignmentCounts: {}, notes: [], warnings: [] },
});

let fixture: InMemoryDatabaseFixture;
beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase();
  fixture.database.insert(muscleGroups).values({ id: 'back_lats', displayName: 'Lats', familyName: 'Back',
    sortOrder: 0, isEditable: 0 }).run();
});
afterEach(() => fixture.close());

it('imports the final kg/contribution model locally without hidden session snapshots', () => {
  const pkg = JSON.parse(serializeBogaSessionImportPackage(makePackage())) as BogaSessionImportPackage;
  expect(validateBogaSessionImportPackage(pkg)).toEqual({ ok: true, errors: [] });
  const result = importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' });
  expect(result.validation.errors).toEqual([]);
  expect(result.wrote).toBe(true);
  expect(pkg.schema).toBe('boga.session-import.v4');
  expect(fixture.database.select().from(userSettings).get()).toMatchObject({ bodyweightCalculationsEnabled: true,
    localDirty: true });
  expect(fixture.database.select().from(bodyWeightMeasurements).get()).toMatchObject({ weightKg: 81.65,
    localDirty: true });
  expect(fixture.database.select().from(exerciseDefinitions).get()).toMatchObject({ bodyweightContribution: 1,
    loadInputMode: 'per_side_load' });
  expect(fixture.database.select().from(exerciseSets).get()).toMatchObject({ weightValue: '20',
    plannedWeightValue: '40', performanceStatus: 'unperformed' });
  expect(fixture.database.select().from(sessions).get()).not.toHaveProperty('bodyWeightKg');

  const repeated = importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' });
  expect(repeated.report.counts).toMatchObject({ sessionsInserted: 0,
    bodyWeightMeasurementsInserted: 0, exerciseSetsInserted: 0 });
});

it('emits only final owner-scoped sync fields', () => {
  const entities = buildRemoteImportWireEntities(makePackage());
  expect(entities.find(entity => entity.type === 'user_settings')?.fields)
    .toEqual(expect.objectContaining({ bodyweight_calculations_enabled: true }));
  expect(entities.find(entity => entity.type === 'body_weight_measurements')?.fields)
    .toEqual(expect.objectContaining({ weight_kg: 81.65 }));
  expect(entities.find(entity => entity.type === 'exercise_definitions')?.fields)
    .toEqual(expect.objectContaining({ bodyweight_contribution: 1, load_input_mode: 'per_side_load' }));
  expect(entities.find(entity => entity.type === 'exercise_sets')?.fields)
    .toEqual(expect.objectContaining({ weight_value: '20', planned_weight_value: '40',
      performance_status: 'unperformed' }));
  expect(entities.find(entity => entity.type === 'sessions')?.fields).not.toHaveProperty('body_weight_kg');
});

it.each([
  ['reading metadata', (pkg: BogaSessionImportPackage) => Object.assign(pkg.bodyWeightMeasurements[0], { weightUnit: 'lb' })],
  ['exercise metadata', (pkg: BogaSessionImportPackage) => Object.assign(pkg.exerciseDecisions[0], { loadRules: {} })],
  ['set metadata', (pkg: BogaSessionImportPackage) => Object.assign(pkg.sessions[0].exercises[0].sets[0], { externalLoadMode: 'added' })],
  ['session snapshot', (pkg: BogaSessionImportPackage) => Object.assign(pkg.sessions[0], { bodyWeightKg: 80 })],
])('rejects obsolete %s instead of silently importing it', (_label, mutate) => {
  const pkg = makePackage();
  mutate(pkg);
  expect(validateBogaSessionImportPackage(pkg).ok).toBe(false);
  expect(() => buildRemoteImportWireEntities(pkg)).toThrow();
  expect(importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' }).wrote).toBe(false);
  expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
});

it('rejects invalid readings, contributions and future dates before writing', () => {
  const invalidReading = makePackage(); invalidReading.bodyWeightMeasurements[0].weightKg = Number.NaN;
  expect(validateBogaSessionImportPackage(invalidReading).ok).toBe(false);
  const invalidContribution = makePackage();
  if (invalidContribution.exerciseDecisions[0].decision === 'create_new') {
    invalidContribution.exerciseDecisions[0].bodyweightContribution = 1.1;
  }
  expect(validateBogaSessionImportPackage(invalidContribution).ok).toBe(false);
  const future = makePackage(); future.bodyWeightMeasurements[0].measuredAt = '2999-01-01T12:00:00.000Z';
  expect(validateBogaSessionImportPackage(future).errors.join(' ')).toContain('later');
  expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
});

it.each([null, {}, [null], [{ id: 'bad' }]])('rejects malformed reading collections without partial writes (%j)', value => {
  const pkg = makePackage(); pkg.bodyWeightMeasurements = value as never;
  const result = importBogaSessionPackageToLocalDb(fixture.database, pkg, { importingProfileLabel: 'test' });
  expect(result.validation.ok).toBe(false);
  expect(result.wrote).toBe(false);
  expect(fixture.database.select().from(bodyWeightMeasurements).all()).toHaveLength(0);
});
