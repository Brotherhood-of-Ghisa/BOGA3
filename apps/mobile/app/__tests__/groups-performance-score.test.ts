import { estimateOneRepMax } from '@/src/exercise-calculations';
import { scoreGroupPerformance, type GroupPerformanceInput } from '@/src/groups/performance-score';
import type { GroupExerciseRules, GroupMetric } from '@/src/groups/metric-contract';

const rules: GroupExerciseRules = { name: 'Pull-up', loadInputMode: 'total_load', bodyweightCoefficient: 1,
  movementStandard: 'Strict pull-up', loadingMethod: 'Belt', defaultMetric: 'relative_strength' };
const input: GroupPerformanceInput = { weightValue: '20', weightUnit: 'kg', repsValue: '5', externalLoadMode: 'added',
  performanceStatus: null, bodyWeightKg: 60, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'r', bodyWeightMeasuredAt: new Date(1000), live: true,
  source: { loadInputMode: 'total_load', movementStandard: 'Strict pull-up', loadingMethod: 'Belt' } };
const value = (p: GroupPerformanceInput, metric: GroupMetric, target = rules) => scoreGroupPerformance(p, target).scores.find(s => s.metric === metric)?.value;

describe('Shared target-specific group scores', () => {
  it('reverses absolute and relative ranking for the milestone equal-rep example', () => {
    const light = input, heavy = { ...input, bodyWeightKg: 90 };
    expect(value(light, 'absolute_strength')).toBeCloseTo(estimateOneRepMax(80, 5)!, 10);
    expect(value(heavy, 'absolute_strength')).toBeCloseTo(estimateOneRepMax(110, 5)!, 10);
    expect(value(light, 'absolute_strength')!).toBeLessThan(value(heavy, 'absolute_strength')!);
    expect(value(light, 'relative_strength')!).toBeGreaterThan(value(heavy, 'relative_strength')!);
    expect(scoreGroupPerformance(light, rules).addedPercentBodyweight).toBeCloseTo(100 / 3, 10);
  });

  it('uses each group coefficient and the source distribution exactly once', () => {
    const p = { ...input, bodyWeightKg: 80, weightValue: '10', repsValue: '8', source: { ...input.source, loadInputMode: 'per_side_load' } };
    expect(scoreGroupPerformance(p, rules).effectiveResistanceKg).toBe(100);
    expect(scoreGroupPerformance(p, { ...rules, loadInputMode: 'per_side_load' }).effectiveResistanceKg).toBe(100);
    expect(scoreGroupPerformance(p, { ...rules, bodyweightCoefficient: 0.7 }).effectiveResistanceKg).toBe(76);
    expect(value(p, 'absolute_strength')).toBeCloseTo(estimateOneRepMax(100, 8)!, 10);
  });

  it('requires explicit unassisted meaning but no B for reps', () => {
    const zero = { ...input, weightValue: '0', bodyWeightKg: null };
    expect(scoreGroupPerformance(zero, rules).scores).toEqual([{ metric: 'bodyweight_reps', value: 5, unit: 'reps' }]);
    expect(scoreGroupPerformance({ ...zero, weightValue: '' }, rules).scores).toEqual([{ metric: 'bodyweight_reps', value: 5, unit: 'reps' }]);
    for (const externalLoadMode of [null, 'assistance', 'unquantified_assistance']) {
      expect(value({ ...zero, externalLoadMode }, 'bodyweight_reps')).toBeUndefined();
    }
    for (const performanceStatus of ['planned', 'unperformed', 'skipped', 'future-status']) {
      expect(scoreGroupPerformance({ ...zero, performanceStatus }, rules).scores).toEqual([]);
    }
    expect(value({ ...zero, live: false }, 'bodyweight_reps')).toBeUndefined();
    expect(value({ ...zero, source: { ...zero.source, movementStandard: 'Kipping pull-up' } }, 'bodyweight_reps')).toBeUndefined();
  });

  it('normalizes quantified assistance and rejects unusable load contexts', () => {
    const assisted = { ...input, externalLoadMode: 'assistance', weightUnit: 'lb' };
    expect(scoreGroupPerformance(assisted, rules).effectiveResistanceKg).toBeCloseTo(60 - 20 * 0.45359237, 12);
    expect(value(assisted, 'bodyweight_reps')).toBeUndefined();
    expect(scoreGroupPerformance({ ...assisted, weightValue: '200' }, rules).scores).toEqual([]);
    expect(scoreGroupPerformance({ ...input, source: { ...input.source, metadataKnown: false } }, rules).scores).toEqual([]);
    expect(scoreGroupPerformance({ ...input, weightUnit: 'unknown' }, rules).scores).toEqual([]);
    expect(scoreGroupPerformance({ ...input, bodyWeightKg: null }, rules).scores).toEqual([]);
  });

  it('retains conventional mode conversion and does not require B', () => {
    const conventional: GroupExerciseRules = { ...rules, bodyweightCoefficient: 0, movementStandard: null, loadingMethod: null, defaultMetric: 'e1rm' };
    const p = { ...input, externalLoadMode: null, bodyWeightKg: null, source: { ...input.source, loadInputMode: 'per_side_load' } };
    expect(value(p, 'weight', conventional)).toBe(40);
    expect(scoreGroupPerformance(p, conventional).effectiveResistanceKg).toBe(40);
    expect(scoreGroupPerformance({ ...p, bodyWeightKg: 80 }, conventional).addedPercentBodyweight).toBeNull();
    expect(value(p, 'e1rm', conventional)).toBeCloseTo(estimateOneRepMax(20, 5)! * 2, 10);
    expect(value({ ...p, weightUnit: 'lb' }, 'weight', conventional)).toBeCloseTo(40 * 0.45359237, 12);
  });
});


it('does not rank strength from a numeric weight with malformed saved provenance', () => {
  const bad = { ...input, bodyWeightMeasurementId: null };
  expect(scoreGroupPerformance(bad, rules).scores).toEqual([]);
  expect(scoreGroupPerformance({ ...bad, weightValue: '0' }, rules).scores)
    .toEqual([{ metric: 'bodyweight_reps', value: 5, unit: 'reps' }]);
  const estimate = { ...input, bodyWeightSource: 'historical_estimate', bodyWeightMeasurementId: 'reading',
    bodyWeightMeasuredAt: new Date('2026-09-20T12:00:00Z') };
  expect(value(estimate, 'absolute_strength')).toBeUndefined();
});
