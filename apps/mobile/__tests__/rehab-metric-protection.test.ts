import {
  isConfirmedPerformedSet,
  isCountedSession,
  isVolumeSet,
  isWorkingSet,
  isWorkingSetType,
} from '@/src/exercise-calculations/set-semantics';
import {
  eligibleSetsByBlockInSessionOrder,
  pickBestEstimatedOneRepMaxSet,
  pickTopWeightSet,
  summarizeSessionBests,
} from '@/src/exercise-calculations/best-set';
import { createRecordBook } from '@/src/exercise-calculations/records';
import { calculateSetMetrics } from '@/src/exercise-calculations/load-metrics';
import { projectRmCurveSet } from '@/src/exercise-calculations/rm-curve';
import {
  collectMuscleSetContributions,
  countMuscleRehabSets,
  countMuscleSets,
  type MuscleAnalyticsInput,
} from '@/src/data/muscle-analytics';

describe('rehab metric protection and PR isolation', () => {
  const ordinaryLoadContext = {
    policy: 'ordinary' as const,
    loadInputMode: 'total_load' as const,
    bodyweightContribution: 0,
    bodyWeightKg: null,
  };

  it('guarantees rehab sets are not working sets or volume sets under default policy', () => {
    const rehabSet = {
      weight: '60',
      reps: '10',
      setType: 'rehab',
      performanceStatus: null,
    };
    expect(isConfirmedPerformedSet(rehabSet)).toBe(true);
    expect(isWorkingSetType('rehab')).toBe(false);
    expect(isWorkingSet(rehabSet)).toBe(false);
    expect(isVolumeSet(rehabSet)).toBe(false);
  });

  it('does not count a session that contains only rehab sets', () => {
    const rehabSets = [
      { weight: '40', reps: '12', setType: 'rehab', performanceStatus: null },
      { weight: '50', reps: '10', setType: 'rehab', performanceStatus: null },
    ];
    const counted = isCountedSession(rehabSets, (s) => s);
    expect(counted).toBe(false);

    const blocks = [{
      id: 'b1',
      orderIndex: 0,
      loadContext: ordinaryLoadContext,
      sets: [
        { id: 's1', orderIndex: 0, weightValue: '40', repsValue: '12', setType: 'rehab' },
        { id: 's2', orderIndex: 1, weightValue: '50', repsValue: '10', setType: 'rehab' },
      ],
    }];
    const bests = summarizeSessionBests(blocks);
    expect(bests).toBeNull();
  });

  it('protects PRs from regressions when an injured lifter logs light rehab sets', () => {
    // Session 1: Healthy lifter logs 100 kg x 5 reps working set (PR baseline)
    const book = createRecordBook();
    const flags1 = book.add({
      oneRepMax: { value: 116.58 },
      weight: { weight: 100, reps: 5 },
      volume: { value: 500 },
    });
    expect(flags1.oneRepMax).toBe(false); // First session establishes baseline
    expect(flags1.weight).toBe(false);

    // Session 2: Injured lifter performs a light rehab workout of 40 kg x 10 reps
    const rehabBlock = [{
      id: 'b-rehab',
      orderIndex: 0,
      loadContext: ordinaryLoadContext,
      sets: [
        { id: 'set-rehab-1', orderIndex: 0, weightValue: '40', repsValue: '10', setType: 'rehab' },
      ],
    }];
    const rehabBests = summarizeSessionBests(rehabBlock);
    expect(rehabBests).toBeNull();

    // Verify eligible sets by block ignores rehab sets
    const eligibleSets = eligibleSetsByBlockInSessionOrder(rehabBlock);
    expect(eligibleSets.flat()).toHaveLength(0);

    // If rehab sets are evaluated against records, they never beat existing records
    const best1rm = pickBestEstimatedOneRepMaxSet(eligibleSets.flat());
    const topWeight = pickTopWeightSet(eligibleSets.flat());
    expect(best1rm).toBeNull();
    expect(topWeight).toBeNull();

    // Session 3: Recovered lifter lifts 105 kg x 5 reps -> beats the 100 kg PR
    const flags3 = book.add({
      oneRepMax: { value: 122.41 },
      weight: { weight: 105, reps: 5 },
      volume: { value: 525 },
    });
    expect(flags3.oneRepMax).toBe(true);
    expect(flags3.weight).toBe(true);
    expect(flags3.volume).toBe(true);
  });

  it('keeps raw row calculations intact for rehab sets while excluding them from RM curves', () => {
    const rehabSetInput = {
      policy: 'ordinary' as const,
      loadInputMode: 'total_load' as const,
      bodyweightContribution: 0,
      bodyWeightKg: null,
      weightValue: '50',
      repsValue: '10',
      setType: 'rehab',
      performanceStatus: null,
    };

    // Row-level metrics are computed accurately for auditability and display
    const rowMetrics = calculateSetMetrics(rehabSetInput);
    expect(rowMetrics.eligible).toBe(true);
    if (!rowMetrics.eligible || rowMetrics.load.status !== 'known') throw new Error('ineligible load');
    expect(rowMetrics.volumeKgReps).toBe(500);
    expect(rowMetrics.load.calculatedLoadKg).toBe(50);
    expect(rowMetrics.estimatedOneRepMaxKg).toBeGreaterThan(50);

    // Analytical RM curve projection immediately rejects rehab sets
    const rmCurveResult = projectRmCurveSet(rehabSetInput);
    expect(rmCurveResult).toBe('not_working');
  });

  it('segregates rehab sets from working set targets while preserving recovery tracking in muscle analytics', () => {
    const input: MuscleAnalyticsInput = {
      sessions: [{ id: 'sess-1', completedAt: new Date('2026-11-13T10:00:00Z') }],
      sessionExercises: [{ id: 'sex-1', sessionId: 'sess-1', exerciseDefinitionId: 'def-bench' }],
      exerciseSets: [
        { id: 'set-1', sessionExerciseId: 'sex-1', orderIndex: 0, setType: 'warm_up', weightValue: '50', repsValue: '10' },
        { id: 'set-2', sessionExerciseId: 'sex-1', orderIndex: 1, setType: 'rehab', weightValue: '60', repsValue: '12' },
        { id: 'set-3', sessionExerciseId: 'sex-1', orderIndex: 2, setType: 'rir_2', weightValue: '80', repsValue: '8' },
      ],
      muscleMappings: [{
        exerciseDefinitionId: 'def-bench',
        muscleGroupId: 'chest',
        role: 'primary',
      }],
      muscleGroups: [{
        id: 'chest',
        displayName: 'Chest',
        familyName: 'Upper',
        sortOrder: 1,
      }],
    };

    // Standard run (without includeRehabSets): only the working set (set-3) is emitted
    const standardContributions = collectMuscleSetContributions(input);
    expect(standardContributions).toHaveLength(1);
    expect(standardContributions[0].setId).toBe('set-3');
    expect(standardContributions[0].working).toBe(true);

    const standardCounts = countMuscleSets(standardContributions);
    expect(standardCounts.primarySetCount).toBe(1);
    expect(standardCounts.weightedSetCount).toBe(1);

    // Dedicated recovery tracking run (with includeRehabSets: true)
    const recoveryContributions = collectMuscleSetContributions({
      ...input,
      includeRehabSets: true,
    });
    // set-2 (rehab) and set-3 (working) are collected; warm_up is excluded
    expect(recoveryContributions).toHaveLength(2);

    const rehabContrib = recoveryContributions.find((c) => c.setId === 'set-2');
    expect(rehabContrib).toBeDefined();
    expect(rehabContrib!.rehab).toBe(true);
    expect(rehabContrib!.working).toBe(false);
    expect(rehabContrib!.physicalWorking).toBe(false);
    expect(rehabContrib!.volumeIncluded).toBe(false);
    expect(rehabContrib!.setVolume).toBe(30 * 12); // Per-side load (60 / 2 = 30 kg) * 12 reps

    // Working set counts are STILL unaffected (rehab sets do not satisfy working targets)
    const workingCounts = countMuscleSets(recoveryContributions);
    expect(workingCounts.primarySetCount).toBe(1);
    expect(workingCounts.weightedSetCount).toBe(1);

    // Dedicated rehab counter captures the rehab sets
    const rehabCounts = countMuscleRehabSets(recoveryContributions);
    expect(rehabCounts.primarySetCount).toBe(1);
    expect(rehabCounts.weightedSetCount).toBe(1);
  });
});
