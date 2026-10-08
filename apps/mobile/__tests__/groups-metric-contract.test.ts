import {
  GROUP_METRICS,
  GROUP_METRIC_UNITS,
  checkGroupLinkCompatibility,
  groupEnteredWeightFactor,
  isGroupMetricValue,
  validateGroupExerciseRules,
  type GroupExerciseRules,
} from '@/src/groups/metric-contract';
import loadFactorVectors from '@/src/groups/load-factor-vectors.json';
import type { LoadInputMode } from '@/src/exercise-core';

const pull: GroupExerciseRules = {
  name: 'Pull-up',
  loadInputMode: 'total_load',
  bodyweightCalculationsEnabled: true,
  bodyweightContribution: 1,
  defaultMetric: 'e1rm',
};

describe('group metric contract', () => {
  it('matches the shared D6 load-factor vectors', () => {
    expect(loadFactorVectors.cases).toHaveLength(4);
    for (const { source, target, factor } of loadFactorVectors.cases) {
      expect(groupEnteredWeightFactor(source as LoadInputMode, target as LoadInputMode)).toBe(factor);
    }
  });

  it('uses the same Weight/1RM vocabulary for every calculation policy', () => {
    expect(GROUP_METRICS).toEqual(['weight', 'e1rm']);
    for (const defaultMetric of GROUP_METRICS) {
      expect(validateGroupExerciseRules({ ...pull, defaultMetric }))
        .toEqual({ ok: true, value: { ...pull, defaultMetric } });
      expect(validateGroupExerciseRules({ ...pull, bodyweightCalculationsEnabled: false, defaultMetric }))
        .toMatchObject({ ok: true });
    }
    expect(validateGroupExerciseRules({ ...pull, defaultMetric: 'unknown' }))
      .toMatchObject({ ok: false, field: 'defaultMetric' });
  });

  it('accepts only positive finite kg scores', () => {
    for (const [metric, unit] of Object.entries(GROUP_METRIC_UNITS)) {
      expect(isGroupMetricValue({ metric, unit, value: 8 })).toBe(true);
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(isGroupMetricValue({ metric: 'e1rm', unit: 'kg', value })).toBe(false);
    }
    expect(isGroupMetricValue({ metric: 'e1rm', unit: 'unknown', value: 8 })).toBe(false);
    expect(isGroupMetricValue({ metric: 'e1rm', value_kg: 8 })).toBe(false);
  });

  it('matches Weight distribution without comparing personal contributions', () => {
    const source = { loadInputMode: 'total_load' };
    expect(checkGroupLinkCompatibility(source, pull)).toEqual({ compatible: true, enteredWeightFactor: 1 });
    expect(checkGroupLinkCompatibility(source, { ...pull, bodyweightContribution: 0.7 }))
      .toEqual({ compatible: true, enteredWeightFactor: 1 });
    expect(checkGroupLinkCompatibility({ loadInputMode: 'per_side_load' }, pull))
      .toEqual({ compatible: true, enteredWeightFactor: 2 });
    expect(checkGroupLinkCompatibility(source, { ...pull, loadInputMode: 'per_side_load' }))
      .toEqual({ compatible: true, enteredWeightFactor: 0.5 });
  });
});
