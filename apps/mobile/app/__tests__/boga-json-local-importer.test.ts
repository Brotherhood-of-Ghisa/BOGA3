import { eq } from 'drizzle-orm';

import {
  importBogaSessionPackageToLocalDb,
  planBogaLocalImport,
} from '@/scripts/import/import-boga-json-local';
import { __resetClockForTests } from '@/src/data/clock';
import {
  exerciseDefinitions,
  exerciseMuscleMappings,
  exerciseSets,
  gyms,
  muscleGroups,
  sessionExercises,
  sessions,
} from '@/src/data/schema';
import {
  createInMemoryDatabase,
  type InMemoryDatabaseFixture,
} from './helpers/in-memory-db';
import type { BogaSessionImportPackage } from '@/scripts/import/boga-import-contract';

let fixture: InMemoryDatabaseFixture;

const PROFILE_LABEL = 'Synthetic Local Profile';
const STARTED_AT = '2026-06-04T12:05:00.000Z';
const COMPLETED_AT = '2026-06-04T13:05:00.000Z';

beforeEach(() => {
  __resetClockForTests();
  fixture = createInMemoryDatabase({ foreignKeys: true });
  fixture.database
    .insert(muscleGroups)
    .values({ id: 'legs', displayName: 'Legs', familyName: 'Lower', sortOrder: 1 })
    .run();
  fixture.database.insert(gyms).values({ id: 'gym-lunch', name: 'Lunch Gym' }).run();
  fixture.database
    .insert(exerciseDefinitions)
    .values({ id: 'exercise-bench', name: 'Bench Press' })
    .run();
});

afterEach(() => {
  fixture.close();
  __resetClockForTests();
});

const basePackage = (): BogaSessionImportPackage => ({
  schema: 'boga.session-import.v1',
  generatedAt: '2026-06-04T14:00:00.000Z',
  target: {
    importingProfileLabel: PROFILE_LABEL,
    localDatabasePath: '/tmp/synthetic-local.db',
    catalogSnapshot: {
      exercises: [{ id: 'exercise-bench', name: 'Bench Press' }],
      gyms: [{ id: 'gym-lunch', name: 'Lunch Gym' }],
    },
  },
  source: {
    app: 'SyntheticSource',
    exportFile: {
      path: 'synthetic-export.xml',
      sizeBytes: 42,
      sha256: 'synthetic-source-sha',
    },
    timezone: 'Europe/London',
    rowCount: 2,
    skippedRowCount: 0,
  },
  options: {
    sessionClusterGapMinutes: 90,
    shortSessionThresholdMinutes: 30,
    shortSessionDefaultDurationMinutes: 60,
    longSessionWarningThresholdMinutes: 90,
    gymAssignments: {
      midday: 'gym-lunch',
      weekdayEvening: null,
      weekend: null,
    },
  },
  exerciseDecisions: [
    {
      sourceExerciseName: 'Bench Press',
      decision: 'map_existing',
      exerciseDefinitionId: 'exercise-bench',
      exerciseName: 'Bench Press',
    },
    {
      sourceExerciseName: 'Zercher Squat',
      decision: 'create_new',
      importExerciseKey: 'synthetic-create-zercher-squat',
      exerciseName: 'Zercher Squat',
      muscleMappings: [{ muscleGroupId: 'legs', weight: 1, role: 'primary' }],
      warnings: [],
    },
  ],
  sessions: [
    {
      importSessionKey: 'synthetic-session-1',
      localDate: '2026-06-04',
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      durationSec: 3600,
      rawSpanSec: 120,
      gymId: 'gym-lunch',
      gymBucket: 'midday',
      sourceWorkoutNames: ['Lunch Lift'],
      warnings: [
        {
          code: 'duration_inferred_short_span',
          severity: 'warning',
          message: 'Synthetic short duration warning.',
        },
      ],
      exercises: [
        {
          orderIndex: 0,
          sourceExerciseName: 'Bench Press',
          targetExercise: {
            kind: 'existing',
            exerciseDefinitionId: 'exercise-bench',
            exerciseName: 'Bench Press',
          },
          sets: [
            {
              orderIndex: 0,
              repsValue: '5',
              weightValue: '100',
              setType: null,
              source: {
                rowIndex: 1,
                workoutName: 'Lunch Lift',
                exerciseName: 'Bench Press',
                loggedAtLocal: '2026-06-04T12:05:00',
                type: 'Normal',
                targetRegion: 'Chest',
                targetMusclesPrimary: 'Chest',
                targetMusclesSecondary: '',
              },
              warnings: [],
            },
          ],
        },
        {
          orderIndex: 1,
          sourceExerciseName: 'Zercher Squat',
          targetExercise: {
            kind: 'create',
            importExerciseKey: 'synthetic-create-zercher-squat',
            exerciseName: 'Zercher Squat',
          },
          sets: [
            {
              orderIndex: 0,
              repsValue: '8',
              weightValue: '40',
              setType: null,
              source: {
                rowIndex: 2,
                workoutName: 'Lunch Lift',
                exerciseName: 'Zercher Squat',
                loggedAtLocal: '2026-06-04T12:07:00',
                type: 'Normal',
                targetRegion: 'Legs',
                targetMusclesPrimary: 'Legs',
                targetMusclesSecondary: '',
              },
              warnings: [],
            },
          ],
        },
      ],
    },
  ],
  report: {
    counts: {
      sourceRows: 2,
      skippedRows: 0,
      importedRows: 2,
      inferredSessions: 1,
      notesPreserved: 0,
      unresolvedExercises: 0,
      durationWarnings: 1,
    },
    unresolvedExercises: [],
    gymAssignmentCounts: { 'gym-lunch': 1 },
    notes: [],
    warnings: [
      {
        code: 'duration_inferred_short_span',
        severity: 'warning',
        message: 'Synthetic short duration warning.',
      },
    ],
  },
});

const importOptions = {
  importingProfileLabel: PROFILE_LABEL,
  localDatabasePath: '/tmp/synthetic-local.db',
};

describe('BOGA JSON local importer', () => {
  it('validates unresolved and FK-broken packages before writing', () => {
    const unresolved = basePackage();
    unresolved.report.unresolvedExercises = [
      { sourceExerciseName: 'Mystery Curl', rowCount: 1, sampleRows: [1] },
    ];

    expect(planBogaLocalImport(fixture.database, unresolved, importOptions).validation.errors).toContain(
      'report.unresolvedExercises must be empty for importer-ready packages'
    );

    const missingGym = basePackage();
    missingGym.sessions[0].gymId = 'missing-gym';

    expect(planBogaLocalImport(fixture.database, missingGym, importOptions).validation.errors).toContain(
      'sessions[0].gymId "missing-gym" does not exist in the target local database'
    );
    expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
  });

  it('treats duration warnings as fatal only when configured', () => {
    expect(
      planBogaLocalImport(fixture.database, basePackage(), {
        ...importOptions,
        fatalDurationWarnings: true,
      }).validation.errors
    ).toContain('fatal warning duration_inferred_short_span: Synthetic short duration warning.');
  });

  it('dry-runs without writing any rows', () => {
    const result = importBogaSessionPackageToLocalDb(fixture.database, basePackage(), {
      ...importOptions,
      dryRun: true,
    });

    expect(result.wrote).toBe(false);
    expect(result.report.counts.sessionsToInsert).toBe(1);
    expect(result.report.counts.exerciseDefinitionsToInsert).toBe(1);
    expect(fixture.database.select().from(sessions).all()).toHaveLength(0);
    expect(fixture.database.select().from(sessionExercises).all()).toHaveLength(0);
    expect(fixture.database.select().from(exerciseSets).all()).toHaveLength(0);
  });

  it('inserts the package in FK-safe order and marks imported sync rows dirty', () => {
    const result = importBogaSessionPackageToLocalDb(fixture.database, basePackage(), importOptions);

    expect(result.wrote).toBe(true);
    expect(result.report.counts.sessionsInserted).toBe(1);
    expect(result.report.counts.exerciseDefinitionsInserted).toBe(1);

    const sessionRows = fixture.database.select().from(sessions).all();
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]).toMatchObject({
      status: 'completed',
      gymId: 'gym-lunch',
      durationSec: 3600,
      localDirty: true,
    });
    expect(sessionRows[0].startedAt.toISOString()).toBe(STARTED_AT);
    expect(sessionRows[0].completedAt?.toISOString()).toBe(COMPLETED_AT);
    expect(sessionRows[0].localUpdatedAtMs).toBeGreaterThan(0);

    const createdExercise = fixture.database
      .select()
      .from(exerciseDefinitions)
      .where(eq(exerciseDefinitions.name, 'Zercher Squat'))
      .get();
    expect(createdExercise).toMatchObject({ localDirty: true });

    const mappings = fixture.database.select().from(exerciseMuscleMappings).all();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      exerciseDefinitionId: createdExercise?.id,
      muscleGroupId: 'legs',
      localDirty: true,
    });

    const exerciseRows = fixture.database.select().from(sessionExercises).all();
    expect(exerciseRows.map((row) => row.orderIndex)).toEqual([0, 1]);
    expect(exerciseRows.every((row) => row.localDirty)).toBe(true);

    const setRows = fixture.database.select().from(exerciseSets).all();
    expect(setRows).toHaveLength(2);
    expect(setRows.map((row) => row.weightValue)).toEqual(['100', '40']);
    expect(setRows.every((row) => row.localDirty)).toBe(true);

    const stamps = [
      createdExercise?.localUpdatedAtMs,
      mappings[0].localUpdatedAtMs,
      sessionRows[0].localUpdatedAtMs,
      ...exerciseRows.map((row) => row.localUpdatedAtMs),
      ...setRows.map((row) => row.localUpdatedAtMs),
    ];
    const numericStamps = stamps.filter((stamp): stamp is number => typeof stamp === 'number' && stamp > 0);
    expect(numericStamps).toHaveLength(stamps.length);
    expect([...numericStamps].sort((a, b) => a - b)).toEqual(numericStamps);
  });

  it('is idempotent for the same package by default', () => {
    importBogaSessionPackageToLocalDb(fixture.database, basePackage(), importOptions);

    const rerun = importBogaSessionPackageToLocalDb(fixture.database, basePackage(), importOptions);

    expect(rerun.report.counts.alreadyImportedSessions).toBe(1);
    expect(rerun.report.counts.sessionsInserted).toBe(0);
    expect(fixture.database.select().from(sessions).all()).toHaveLength(1);
    expect(fixture.database.select().from(sessionExercises).all()).toHaveLength(2);
    expect(fixture.database.select().from(exerciseSets).all()).toHaveLength(2);
  });
});
