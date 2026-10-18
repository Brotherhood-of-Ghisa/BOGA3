import {
  deriveSessionMuscleVolumeComparisons,
  type PersonalRecordSessionInput,
  type SessionInsightSetInput,
} from '@/src/session-insights';

const catalog = {
  exerciseDefinitions: [{ bodyweightContribution: 0, id: 'bench', loadInputMode: 'total_load' as const }],
  muscleMappings: [
    { exerciseDefinitionId: 'bench', muscleGroupId: 'chest', role: 'primary' as const },
    { exerciseDefinitionId: 'bench', muscleGroupId: 'triceps', role: 'secondary' as const },
  ],
  muscleGroups: [
    { id: 'chest', displayName: 'Chest', familyName: 'Torso', sortOrder: 1 },
    { id: 'triceps', displayName: 'Triceps', familyName: 'Arms', sortOrder: 2 },
  ],
};

const set = (id: string, weightValue: string, setType: string | null = 'rir_2'): SessionInsightSetInput => ({
  id, weightValue, setType, repsValue: '10', orderIndex: 0, performanceStatus: null,
});

const session = (sessionId: string, day: string, sets: SessionInsightSetInput[]): PersonalRecordSessionInput => ({
  sessionId, status: 'completed', completedAt: new Date(`2026-09-${day}T12:00:00Z`),
  exercises: [{ id: `${sessionId}-bench`, exerciseDefinitionId: 'bench', exerciseName: 'Bench', orderIndex: 0, sets }],
});

describe('muscle volume comparisons', () => {
  it('counts unspecified but not warm-up performed sets, and only their volume', () => {
    const rows = deriveSessionMuscleVolumeComparisons({
      ...catalog,
      targetSession: session('target', '25', [
        set('warm', '20', 'warm_up'), set('working', '100'), set('unspecified', '50', null),
        { ...set('planned', '100'), performanceStatus: 'planned' },
        { ...set('unchecked', '100'), performanceStatus: 'unperformed' },
        { ...set('deleted', '100'), deletedAt: new Date() },
        set('invalid', 'invalid'),
      ]),
      historicalSessions: [],
    });
    // (100 + 50) × 10, halved per side; the 20 × 10 warm-up counts as a set only.
    // Triceps is secondary here, so it has no comparison row at all.
    expect(rows).toEqual([
      expect.objectContaining({ exerciseDefinitionId: 'chest', workingSetCount: 2, currentVolume: 750 }),
    ]);
  });

  it('compares no muscle trained only by warm-ups and takes no baseline from one', () => {
    const warmUpOnly = (sessionId: string, day: string) => session(sessionId, day, [set(`${sessionId}-warm`, '60', 'warm_up')]);
    expect(deriveSessionMuscleVolumeComparisons({
      ...catalog, targetSession: warmUpOnly('target', '25'), historicalSessions: [],
    })).toEqual([]);

    const rows = deriveSessionMuscleVolumeComparisons({
      ...catalog,
      targetSession: session('target', '25', [set('target-set', '100')]),
      historicalSessions: [warmUpOnly('prior-warm-up', '23'), session('prior', '24', [set('prior-set', '50')])],
    });
    expect(rows[0]).toMatchObject({ exerciseDefinitionId: 'chest', historicalSessionCount: 1, medianVolume: 250 });
  });

  it('retains mapped zero-load targets and zero historical observations', () => {
    const zero = session('zero', '23', [set('zero-set', '0')]);
    const positive = session('positive', '24', [set('positive-set', '50')]);
    const input = { ...catalog, targetSession: session('target', '25', [set('target-set', '100')]), historicalSessions: [zero, positive] };
    expect(deriveSessionMuscleVolumeComparisons(input)[0]).toMatchObject({
      currentVolume: 500, historicalSessionCount: 2, medianVolume: 125,
      percentile25Volume: 62.5, percentile75Volume: 187.5, state: 'distribution',
    });
    expect(deriveSessionMuscleVolumeComparisons({ ...input, targetSession: zero, historicalSessions: [] })[0]).toMatchObject({
      exerciseDefinitionId: 'chest', currentVolume: 0, workingSetCount: 1, state: 'no-history',
    });
    expect(deriveSessionMuscleVolumeComparisons({ ...input, historicalSessions: [zero] })[0]).toMatchObject({
      medianVolume: 0, state: 'single-baseline', historicalSessionCount: 1,
    });
  });

  it('uses only earlier completed non-deleted sessions with mapped performed sets', () => {
    const target = session('target', '25', [set('target-set', '100')]);
    const prior = session('prior', '24', [set('prior-set', '50')]);
    const rows = deriveSessionMuscleVolumeComparisons({
      ...catalog, targetSession: target,
      historicalSessions: [
        prior, target, session('future', '26', [set('future-set', '500')]),
        { ...prior, sessionId: 'active', status: 'active' },
        { ...prior, sessionId: 'deleted', deletedAt: new Date() },
        session('planned', '23', [{ ...set('planned-set', '100'), performanceStatus: 'planned' }]),
      ],
    });
    expect(rows[0]).toMatchObject({ historicalSessionCount: 1, medianVolume: 250 });
    expect(deriveSessionMuscleVolumeComparisons({ ...catalog, muscleMappings: [], targetSession: target, historicalSessions: [prior] })).toEqual([]);
  });

  it('draws no distribution for a muscle trained only as a secondary, and takes no baseline from such a session', () => {
    const squat = (sessionId: string, day: string, weightValue: string): PersonalRecordSessionInput => ({
      sessionId, status: 'completed', completedAt: new Date(`2026-09-${day}T12:00:00Z`),
      exercises: [{
        id: `${sessionId}-squat`, exerciseDefinitionId: 'squat', exerciseName: 'Squat', orderIndex: 0,
        sets: [set(`${sessionId}-squat-set`, weightValue)],
      }],
    });
    const withSquat = {
      exerciseDefinitions: [...catalog.exerciseDefinitions, { bodyweightContribution: 0, id: 'squat', loadInputMode: 'total_load' as const }],
      muscleMappings: [...catalog.muscleMappings, { exerciseDefinitionId: 'squat', muscleGroupId: 'triceps', role: 'primary' as const }],
      muscleGroups: catalog.muscleGroups,
    };
    // Bench is chest primary, triceps secondary: triceps gets no row.
    const benchOnly = deriveSessionMuscleVolumeComparisons({
      ...withSquat, targetSession: session('target', '25', [set('target-set', '100')]), historicalSessions: [],
    });
    expect(benchOnly.map((row) => row.exerciseDefinitionId)).toEqual(['chest']);

    // Triceps is primary today (squat): its Volume adds the bench's secondary work at ½,
    // 100 × 10 / 2 × ½ + 40 × 10 / 2. The bench-day prior trained it only as a secondary,
    // so only the squat-day prior (60 × 10 / 2) is a baseline reading.
    const target = {
      ...session('target', '25', [set('bench-set', '100')]),
      exercises: [...session('target', '25', [set('bench-set', '100')]).exercises, ...squat('target', '25', '40').exercises],
    };
    const rows = deriveSessionMuscleVolumeComparisons({
      ...withSquat, targetSession: target,
      historicalSessions: [session('bench-day', '24', [set('bench-day-set', '200')]), squat('squat-day', '23', '60')],
    });
    expect(rows.find((row) => row.exerciseDefinitionId === 'triceps')).toMatchObject({
      currentVolume: 250 + 200, historicalSessionCount: 1, medianVolume: 300,
    });
  });

  it('draws no comparison for a muscle whose only primary sets are warm-ups', () => {
    const rows = deriveSessionMuscleVolumeComparisons({
      ...catalog, targetSession: session('target', '25', [set('warm', '20', 'warm_up')]), historicalSessions: [],
    });
    expect(rows).toEqual([]);
  });
});
