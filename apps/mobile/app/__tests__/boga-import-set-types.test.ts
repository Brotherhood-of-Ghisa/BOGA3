import { validateBogaSessionImportPackage, type BogaSessionImportPackage } from '../../scripts/import/boga-import-contract';
import {
  enrichBogaImportSetTypes,
  setTypeForRank,
  shouldLeaveImportSetTypesUnregistered,
} from '../../scripts/import/set-type-enricher';

const makePackage = (
  sets: { orderIndex: number; setType: null | string }[],
  exerciseName = 'Bench'
): BogaSessionImportPackage =>
  ({
    schema: 'boga.session-import.v1',
    generatedAt: '2026-06-05T17:02:00.498Z',
    target: {
      importingProfileLabel: 'test',
      catalogSnapshot: {
        exercises: [{ id: 'seed_bench', name: exerciseName }],
        gyms: [],
      },
    },
    source: {
      app: 'GymBook',
      exportFile: { path: 'GymBook.xml' },
      timezone: 'Europe/London',
      rowCount: sets.length,
      skippedRowCount: 0,
    },
    options: {
      sessionClusterGapMinutes: 90,
      shortSessionThresholdMinutes: 30,
      shortSessionDefaultDurationMinutes: 60,
      longSessionWarningThresholdMinutes: 90,
      gymAssignments: { midday: null, weekdayEvening: null, weekend: null },
    },
    exerciseDecisions: [
      {
        sourceExerciseName: exerciseName,
        decision: 'map_existing',
        exerciseDefinitionId: 'seed_bench',
        exerciseName,
      },
    ],
    sessions: [
      {
        importSessionKey: 's1',
        localDate: '2026-06-05',
        startedAt: '2026-06-05T10:00:00.000Z',
        completedAt: '2026-06-05T11:00:00.000Z',
        durationSec: 3600,
        rawSpanSec: 3600,
        gymId: null,
        gymBucket: 'none',
        sourceWorkoutNames: [],
        warnings: [],
        exercises: [
          {
            orderIndex: 0,
            sourceExerciseName: exerciseName,
            targetExercise: {
              kind: 'existing',
              exerciseDefinitionId: 'seed_bench',
              exerciseName,
            },
            sets: sets.map((set, index) => ({
              orderIndex: set.orderIndex,
              repsValue: '5',
              weightValue: '100',
              setType: set.setType,
              source: {
                rowIndex: index,
                workoutName: 'Workout',
                exerciseName,
                loggedAtLocal: '2026-06-05 10:00:00',
                type: '',
                targetRegion: '',
                targetMusclesPrimary: '',
                targetMusclesSecondary: '',
              },
              warnings: [],
            })),
          },
        ],
      },
    ],
    report: {
      counts: {
        sourceRows: sets.length,
        skippedRows: 0,
        importedRows: sets.length,
        inferredSessions: 1,
        notesPreserved: 0,
        unresolvedExercises: 0,
        durationWarnings: 0,
      },
      unresolvedExercises: [],
      gymAssignmentCounts: {},
      notes: [],
      warnings: [],
    },
  }) as BogaSessionImportPackage;

describe('BOGA import set type enrichment', () => {
  it('applies the import effort ladder by set rank', () => {
    expect([0, 1, 2, 3, 4, 5].map((rank) => setTypeForRank(rank, 6))).toEqual([
      'warm_up',
      null,
      'rir_2',
      'rir_1',
      'rir_0',
      'rir_0',
    ]);
    expect(setTypeForRank(0, 1)).toBe('warm_up');
    expect([0, 1].map((rank) => setTypeForRank(rank, 2))).toEqual(['warm_up', null]);
  });

  it('preserves set order while ranking by orderIndex', () => {
    const enriched = enrichBogaImportSetTypes(
      makePackage([
        { orderIndex: 2, setType: null },
        { orderIndex: 0, setType: null },
        { orderIndex: 1, setType: null },
      ])
    );
    const sets = enriched.sessions[0].exercises[0].sets;
    expect(sets.map((set) => set.orderIndex)).toEqual([2, 0, 1]);
    expect(sets.map((set) => set.setType)).toEqual(['rir_2', 'warm_up', null]);
  });

  it('leaves kettlebell swings without registered effort', () => {
    const enriched = enrichBogaImportSetTypes(
      makePackage(
        [
          { orderIndex: 0, setType: 'rir_0' },
          { orderIndex: 1, setType: null },
          { orderIndex: 2, setType: null },
          { orderIndex: 3, setType: null },
        ],
        'Kettlebell Swings'
      )
    );

    expect(enriched.sessions[0].exercises[0].sets.map((set) => set.setType)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('leaves one-arm kettlebell swings without registered effort', () => {
    const enriched = enrichBogaImportSetTypes(
      makePackage(
        [
          { orderIndex: 0, setType: null },
          { orderIndex: 1, setType: null },
          { orderIndex: 2, setType: null },
        ],
        'Kettlebell One-Arm Swings'
      )
    );

    expect(enriched.sessions[0].exercises[0].sets.map((set) => set.setType)).toEqual([null, null, null]);
    expect(shouldLeaveImportSetTypesUnregistered('Single-Arm Kettlebell Swings')).toBe(true);
    expect(shouldLeaveImportSetTypesUnregistered('Kettlebell Swing')).toBe(true);
  });

  it('validates enriched set types and rejects unsupported values', () => {
    const validPackage = enrichBogaImportSetTypes(makePackage([{ orderIndex: 0, setType: null }]));
    expect(validateBogaSessionImportPackage(validPackage).ok).toBe(true);
    expect(validateBogaSessionImportPackage(makePackage([{ orderIndex: 0, setType: 'drop_set' }])).errors).toContain(
      'sessions[0].exercises[0].sets[0].setType must be warm_up|rir_0|rir_1|rir_2|null'
    );
  });
});
