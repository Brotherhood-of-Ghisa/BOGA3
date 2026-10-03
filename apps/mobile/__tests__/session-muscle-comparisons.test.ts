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
  it('counts unspecified but not warm-up performed sets as working sets, and only their volume', () => {
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
    expect(rows).toEqual([
      expect.objectContaining({ exerciseDefinitionId: 'chest', setCount: 3, workingSetCount: 2, currentVolume: 750 }),
      expect.objectContaining({ exerciseDefinitionId: 'triceps', setCount: 3, workingSetCount: 2, currentVolume: 375 }),
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
      percentile5Volume: 12.5, percentile95Volume: 237.5, state: 'distribution',
    });
    expect(deriveSessionMuscleVolumeComparisons({ ...input, targetSession: zero, historicalSessions: [] })[0]).toMatchObject({
      exerciseDefinitionId: 'chest', currentVolume: 0, setCount: 1, workingSetCount: 1, state: 'no-history',
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
});
