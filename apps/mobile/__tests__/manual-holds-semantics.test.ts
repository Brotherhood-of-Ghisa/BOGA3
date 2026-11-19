import { SHARED_EFFORT_POLICY } from '@/src/exercise-calculations/effort-policy';
import { calculateSetMetrics } from '@/src/exercise-calculations/load-metrics';
import { parseSetDuration } from '@/src/exercise-calculations/parse';
import { ordinaryLoadContext } from '@/src/exercise-calculations/analytics';
import { summarizeSessionBests } from '@/src/exercise-calculations/best-set';
import { deriveExerciseSessionFacts } from '@/src/data/exercise-session-facts-derive';
import { accumulateContributionMetrics, createEffortMetricAccumulator, collectMuscleSetContributions, countMuscleSets } from '@/src/data/muscle-analytics';
import {
  canonicalizeSetValues, hydrateSessionSetPerformanceStatus, isConfirmedPerformedSet, isVolumeSet, isWorkingSet,
} from '@/src/exercise-calculations/set-semantics';

const hold = { recordingMode: 'hold', durationSec: 45, reps: '', weight: '', setType: 'rir_0' } as const;

it('counts a confirmed hold as one ordinary effort-selected set, independently of external load', () => {
  expect(isConfirmedPerformedSet(hold)).toBe(true);
  expect(isWorkingSet(hold)).toBe(true);
  expect(isWorkingSet({ ...hold, weight: '12.5' })).toBe(true);
  expect(canonicalizeSetValues(hold)).toEqual({ ...hold, weight: '0' });
  expect(hydrateSessionSetPerformanceStatus(null, hold)).toBeNull();
  for (const setType of ['warm_up', 'technique', 'cooldown', 'rehab']) {
    expect(isWorkingSet({ ...hold, setType })).toBe(false);
  }
  expect(isWorkingSet(hold, { ...SHARED_EFFORT_POLICY,
    workingSetEfforts: SHARED_EFFORT_POLICY.workingSetEfforts.filter(effort => effort !== 'rir_0'),
  })).toBe(false);
});

it('retains counted hold-only facts without inventing records or changing lifting bests', () => {
  const set = { ...hold, id: 'hold', orderIndex: 0, weightValue: '20', repsValue: '', performanceStatus: null };
  const block = { id: 'block', orderIndex: 0, sets: [set], loadContext: ordinaryLoadContext() };
  expect(summarizeSessionBests([block])).toMatchObject({
    workingSets: 1, volumeSets: 0, volumeKg: null, oneRepMax: null, topWeight: null,
  });
  const [facts] = deriveExerciseSessionFacts({ id: 'plank', splitByGym: false }, [{
    sessionId: 'session', completedAt: new Date(2000), gymId: null, blocks: [block],
  }]);
  expect(facts).toMatchObject({ workingSets: 1, volumeSets: 0, bestE1rmKg: null, topWeightKg: null,
    volumeKg: null, prE1rm: false, prWeight: false, prVolume: false });
  const lifting = { ...block, id: 'lifting', sets: [{
    id: 'reps', orderIndex: 0, weightValue: '100', repsValue: '10', setType: 'rir_2', performanceStatus: null,
  }] };
  const before = summarizeSessionBests([lifting]);
  expect(summarizeSessionBests([lifting, block])).toEqual({ ...before, workingSets: 2 });
});

it('attributes counted holds through the existing primary and secondary muscle pools', () => {
  const contributions = collectMuscleSetContributions({
    sessions: [{ id: 'session', completedAt: new Date(2000) }],
    sessionExercises: [{ id: 'card', sessionId: 'session', exerciseDefinitionId: 'plank' }],
    exerciseSets: [{ ...hold, id: 'set', sessionExerciseId: 'card', repsValue: '', weightValue: '0' }],
    muscleMappings: [
      { exerciseDefinitionId: 'plank', muscleGroupId: 'abs', role: 'primary' },
      { exerciseDefinitionId: 'plank', muscleGroupId: 'shoulders', role: 'secondary' },
    ],
    muscleGroups: [
      { id: 'abs', displayName: 'Abs', familyName: 'Core', sortOrder: 0 },
      { id: 'shoulders', displayName: 'Shoulders', familyName: 'Shoulders', sortOrder: 1 },
    ],
  });
  expect(countMuscleSets(contributions)).toMatchObject({ primarySetCount: 1, secondarySetCount: 0, weightedSetCount: 1 });
  expect(countMuscleSets(contributions.filter(row => row.muscleGroupId === 'shoulders'))).toMatchObject({
    primarySetCount: 0, secondarySetCount: 1, weightedSetCount: 0.5,
  });
  expect(contributions.every(row => row.working && !row.volumeIncluded && !row.metrics.eligible)).toBe(true);
  const acc = createEffortMetricAccumulator();
  contributions.forEach(row => accumulateContributionMetrics(acc, row));
  expect(acc).toMatchObject({ workingSetCount: 1, totalVolume: null, highestWeight: null, bestRM1: null });
  const lift = { ...contributions[0], recordingMode: 'reps' as const, durationSec: null,
    setIdentity: 'lift', weightedVolume: 100, volumeIncluded: true, enteredWeightKg: 20 };
  accumulateContributionMetrics(acc, lift);
  expect(acc).toMatchObject({ workingSetCount: 2, totalVolume: 100, highestWeight: 20 });
  accumulateContributionMetrics(acc, contributions[0]);
  expect(acc.totalVolume).toBe(100);
});

it('rejects invalid, unchecked and ambiguous measurements', () => {
  expect(parseSetDuration(300)).toBe(300);
  for (const durationSec of [null, undefined, 0, -1, 0.5, 301, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(parseSetDuration(durationSec)).toBeNull();
    expect(isConfirmedPerformedSet({ ...hold, durationSec })).toBe(false);
  }
  for (const performanceStatus of ['planned', 'unperformed', 'skipped'] as const) {
    expect(isConfirmedPerformedSet({ ...hold, performanceStatus })).toBe(false);
  }
  expect(isConfirmedPerformedSet({ ...hold, reps: '12' })).toBe(false);
  expect(isConfirmedPerformedSet({ ...hold, recordingMode: 'reps', reps: '12' })).toBe(false);
  expect(isConfirmedPerformedSet({ ...hold, weight: 'bad' })).toBe(false);
  expect(isConfirmedPerformedSet({ ...hold, weight: '-1' })).toBe(false);
});

it('never supplies Volume or 1RM for holds, including bodyweight-aware policies', () => {
  expect(isVolumeSet(hold)).toBe(false);
  for (const policy of ['ordinary', 'personal', 'group'] as const) {
    expect(calculateSetMetrics({
      ...hold, weightValue: '20', repsValue: '', policy,
      bodyweightContribution: 1, bodyWeightKg: 80, loadInputMode: 'per_side_load',
    })).toMatchObject({ eligible: false, volumeKgReps: null, estimatedOneRepMaxKg: null });
    expect(calculateSetMetrics({
      ...hold, weightValue: '20', repsValue: '12', policy,
      bodyweightContribution: 1, bodyWeightKg: 80, loadInputMode: 'per_side_load',
    })).toMatchObject({ eligible: false, volumeKgReps: null, estimatedOneRepMaxKg: null });
  }
});
