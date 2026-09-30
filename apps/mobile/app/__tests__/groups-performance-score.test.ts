import { estimateOneRepMax } from '@/src/exercise-calculations';
import { scoreGroupPerformance, type GroupPerformanceInput } from '@/src/groups/performance-score';
import type { GroupExerciseRules, GroupMetric } from '@/src/groups/metric-contract';

const rules: GroupExerciseRules = {
  name: 'Pull-up', loadInputMode: 'total_load', bodyweightCalculationsEnabled: true,
  bodyweightContribution: 1, defaultMetric: 'e1rm',
};
const input: GroupPerformanceInput = {
  weightValue: '20', repsValue: '5', performanceStatus: null,
  bodyWeightKg: 60, bodyWeightSource: 'reading', bodyWeightMeasurementId: 'r',
  bodyWeightMeasuredAt: new Date(1000), live: true,
  source: { loadInputMode: 'total_load' },
};
const value = (performance: GroupPerformanceInput, metric: GroupMetric, target = rules) =>
  scoreGroupPerformance(performance, target).scores.find(score => score.metric === metric)?.value;

describe('target-specific group scores', () => {
  it('keeps Weight raw while changing only the 1RM calculation', () => {
    expect(value(input, 'weight')).toBe(20);
    expect(value(input, 'e1rm')).toBeCloseTo(estimateOneRepMax(80, 5)! - 60, 10);
    expect(value({ ...input, bodyWeightKg: 90 }, 'weight')).toBe(20);
    expect(value({ ...input, bodyWeightKg: 90 }, 'e1rm')).toBeCloseTo(estimateOneRepMax(110, 5)! - 90, 10);
  });

  it('applies source-to-target distribution to 1RM but never raw Weight', () => {
    const performance = { ...input, bodyWeightKg: 80, weightValue: '10', repsValue: '8',
      source: { loadInputMode: 'per_side_load' as const } };
    expect(value(performance, 'weight')).toBe(10);
    expect(value(performance, 'e1rm')).toBeCloseTo(estimateOneRepMax(100, 8)! - 80, 10);
    expect(value(performance, 'e1rm', { ...rules, loadInputMode: 'per_side_load' }))
      .toBeCloseTo((estimateOneRepMax(100, 8)! - 80) / 2, 10);
    expect(value(performance, 'e1rm', { ...rules, bodyweightContribution: 0.7 }))
      .toBeCloseTo(estimateOneRepMax(76, 8)! - 56, 10);
  });

  it('retains raw Weight when a strict dependent 1RM has no reading', () => {
    const missing = { ...input, bodyWeightKg: null, bodyWeightSource: null,
      bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null };
    expect(scoreGroupPerformance(missing, rules).scores)
      .toEqual([{ metric: 'weight', value: 20, unit: 'kg' }]);
    expect(scoreGroupPerformance({ ...missing, weightValue: '0' }, rules).scores).toEqual([]);
    expect(scoreGroupPerformance({ ...missing, weightValue: '' }, rules).scores).toEqual([]);
  });

  it('rejects unperformed or non-live rows', () => {
    for (const performanceStatus of ['planned', 'unperformed', 'skipped', 'future-status']) {
      expect(scoreGroupPerformance({ ...input, performanceStatus }, rules).scores).toEqual([]);
    }
    expect(scoreGroupPerformance({ ...input, live: false }, rules).scores).toEqual([]);
  });

  it('uses ordinary math while the group preference is off', () => {
    const ordinary = { ...rules, bodyweightCalculationsEnabled: false };
    const performance = { ...input, bodyWeightKg: null, bodyWeightSource: null,
      bodyWeightMeasurementId: null, bodyWeightMeasuredAt: null,
      source: { loadInputMode: 'per_side_load' as const } };
    expect(value(performance, 'weight', ordinary)).toBe(20);
    expect(value(performance, 'e1rm', ordinary)).toBeCloseTo(estimateOneRepMax(20, 5)! * 2, 10);
  });

  it('does not use a numeric reading with incomplete provenance for 1RM', () => {
    const malformed = { ...input, bodyWeightMeasurementId: null };
    expect(scoreGroupPerformance(malformed, rules).scores)
      .toEqual([{ metric: 'weight', value: 20, unit: 'kg' }]);
  });
});
