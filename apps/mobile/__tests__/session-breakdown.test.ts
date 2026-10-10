import {
  buildSessionBreakdownExerciseRows,
  buildSessionBreakdownMuscleRows,
  type CurrentSessionMuscleSummary,
  type ExercisePersonalRecord,
  type ExerciseVolumeComparison,
  type SessionInsightExerciseInput,
  type SessionInsightMuscleMapping,
} from '@/src/session-insights';

// The completion summary card's two breakdown pages. A record counts on its
// exercise's primary muscles only, and muscle volume stays role-weighted, so
// neither column sums to the session's own figure.

const group = (id: string, displayName: string, sortOrder: number) => ({
  id,
  displayName,
  familyName: 'Upper',
  sortOrder,
});

const muscleSummary: CurrentSessionMuscleSummary = {
  state: 'mapped',
  workingSetCount: 7,
  mappedSetCount: 7,
  unmappedSetCount: 0,
  contributingMuscleCount: 2,
  muscles: [
    { ...group('chest', 'Chest', 1), workingSetCount: 4, weightedVolume: 5420, relativeVolume: 1 },
    { ...group('triceps', 'Triceps', 2), workingSetCount: 4, weightedVolume: 3610, relativeVolume: 0.67 },
  ],
  workingSetsByMuscle: [
    { ...group('chest', 'Chest', 1), primarySetCount: 4, secondarySetCount: 0, weightedSetCount: 4 },
    { ...group('triceps', 'Triceps', 2), primarySetCount: 0, secondarySetCount: 4, weightedSetCount: 2 },
    // Took sets but no known volume: the volume column has nothing to show.
    { ...group('forearms', 'Forearms', 3), primarySetCount: 0, secondarySetCount: 3, weightedSetCount: 1.5 },
  ],
};

const mappings: SessionInsightMuscleMapping[] = [
  { exerciseDefinitionId: 'bench', muscleGroupId: 'chest', role: 'primary' },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'triceps', role: 'secondary' },
  { exerciseDefinitionId: 'bench', muscleGroupId: 'forearms', role: 'stabilizer' },
];

const benchRecord: ExercisePersonalRecord = {
  exerciseDefinitionId: 'bench',
  exerciseName: 'Bench Press',
  sessionExerciseId: 'ex-bench',
  sessionExerciseOrderIndex: 0,
  sets: [
    {
      sessionExerciseId: 'ex-bench',
      setId: 's2',
      setOrderIndex: 1,
      weight: 100,
      reps: 5,
      estimatedOneRepMax: 116.7,
      oneRepMax: true,
      topWeight: true,
    },
  ],
  volume: 1400,
  baseline: { oneRepMax: 100, weight: { weight: 90, reps: 5 }, volume: 1200 },
};

describe('buildSessionBreakdownMuscleRows', () => {
  it('keeps the shipped row order and adds weighted volume and primary-muscle records', () => {
    const rows = buildSessionBreakdownMuscleRows({
      muscleSummary,
      personalRecords: [benchRecord],
      muscleMappings: mappings,
    });

    expect(rows.map((row) => row.id)).toEqual(['chest', 'triceps', 'forearms']);
    // Bench takes three records (1RM, Top weight, Volume); chest is its only
    // primary muscle, so only chest counts them.
    expect(rows.map((row) => row.recordCount)).toEqual([3, 0, 0]);
    expect(rows.map((row) => row.volume)).toEqual([5420, 3610, null]);
    expect(rows[1]).toMatchObject({ primarySetCount: 0, secondarySetCount: 4, weightedSetCount: 2 });
  });

  it('counts a record on every primary muscle it maps to, so the column need not sum to the session', () => {
    const rows = buildSessionBreakdownMuscleRows({
      muscleSummary,
      personalRecords: [benchRecord],
      muscleMappings: [
        ...mappings,
        { exerciseDefinitionId: 'bench', muscleGroupId: 'triceps', role: 'primary' },
      ],
    });

    // Three records, counted on both primary muscles: six, against a session
    // record count of three. Intended.
    expect(rows.map((row) => row.recordCount)).toEqual([3, 3, 0]);
  });

  it('has no rows without a muscle summary', () => {
    expect(
      buildSessionBreakdownMuscleRows({ muscleSummary: null, personalRecords: [benchRecord], muscleMappings: mappings })
    ).toEqual([]);
  });
});

const comparison = (
  overrides: Partial<ExerciseVolumeComparison> & Pick<ExerciseVolumeComparison, 'exerciseName' | 'sessionExerciseIds'>
): ExerciseVolumeComparison => ({
  exerciseDefinitionId: null,
  sessionExerciseOrderIndex: 0,
  workingSetCount: 0,
  currentVolume: null,
  historicalSessionCount: 0,
  medianVolume: null,
  percentile25Volume: null,
  percentile75Volume: null,
  state: 'no-history',
  ...overrides,
});

const insightExercise = (
  id: string,
  sets: { id: string; weightValue: string; repsValue: string; setType?: string | null }[]
): SessionInsightExerciseInput => ({
  id,
  orderIndex: 0,
  exerciseDefinitionId: 'bench',
  exerciseName: 'Bench Press',
  sets: sets.map((set, index) => ({
    id: set.id,
    orderIndex: index,
    weightValue: set.weightValue,
    repsValue: set.repsValue,
    setType: set.setType ?? null,
  })),
});

describe('buildSessionBreakdownExerciseRows', () => {
  it('reads sets and volume from the comparison, and tops weight across an exercise blocks', () => {
    const rows = buildSessionBreakdownExerciseRows({
      comparisons: [
        comparison({
          exerciseDefinitionId: 'bench',
          exerciseName: 'Bench Press',
          sessionExerciseIds: ['ex-bench-a', 'ex-bench-b'],
          workingSetCount: 4,
          currentVolume: 3520,
        }),
      ],
      exercises: [
        insightExercise('ex-bench-a', [
          { id: 'a1', weightValue: '92.5', repsValue: '5' },
          // A warm-up is no working set, so it cannot be the top weight.
          { id: 'a2', weightValue: '140', repsValue: '3', setType: 'warm_up' },
        ]),
        insightExercise('ex-bench-b', [{ id: 'b1', weightValue: '80', repsValue: '8' }]),
      ],
      personalRecords: [benchRecord],
    });

    expect(rows).toEqual([
      {
        id: 'ex-bench-a',
        exerciseDefinitionId: 'bench',
        name: 'Bench Press',
        workingSetCount: 4,
        volume: 3520,
        topWeight: 92.5,
        recordCount: 3,
      },
    ]);
  });

  it('shows no top weight or records for an exercise without a definition', () => {
    const rows = buildSessionBreakdownExerciseRows({
      comparisons: [comparison({ exerciseName: 'Old Import', sessionExerciseIds: ['ex-legacy'], workingSetCount: 1 })],
      exercises: [],
      personalRecords: [benchRecord],
    });

    expect(rows[0]).toMatchObject({ topWeight: null, recordCount: 0, volume: null });
  });
});
