import {
  BODYWEIGHT_GROUP_METRICS, CONVENTIONAL_GROUP_METRICS, GROUP_METRIC_UNITS,
  checkGroupLinkCompatibility, isGroupMetricValue, metricsForGroupRules, validateGroupExerciseRules,
  type GroupExerciseRules,
} from '@/src/groups/metric-contract';

const pull: GroupExerciseRules = { name: 'Pull-up', loadInputMode: 'total_load', bodyweightCoefficient: 1,
  movementStandard: 'Strict pull-up', loadingMethod: 'Belt', defaultMetric: 'relative_strength' };
const source = { loadInputMode: 'total_load', movementStandard: 'Strict pull-up', loadingMethod: 'Belt' };

describe('Unit-aware group metric contract', () => {
  it('keeps conventional defaults separate from explicit bodyweight defaults', () => {
    expect(metricsForGroupRules(pull)).toEqual(BODYWEIGHT_GROUP_METRICS);
    expect(metricsForGroupRules({ bodyweightCoefficient: 0 })).toEqual(CONVENTIONAL_GROUP_METRICS);
    for (const defaultMetric of BODYWEIGHT_GROUP_METRICS) {
      expect(validateGroupExerciseRules({ ...pull, defaultMetric })).toEqual({ ok: true, value: { ...pull, defaultMetric } });
    }
    expect(validateGroupExerciseRules({ ...pull, defaultMetric: 'weight' })).toMatchObject({ ok: false, field: 'defaultMetric' });
    expect(validateGroupExerciseRules({ ...pull, bodyweightCoefficient: 0, defaultMetric: 'relative_strength' }))
      .toMatchObject({ ok: false, field: 'defaultMetric' });
    expect(validateGroupExerciseRules({ ...pull, defaultMetric: undefined })).toMatchObject({ ok: false, field: 'defaultMetric' });
    expect(validateGroupExerciseRules({ ...pull, movementStandard: '' }))
      .toMatchObject({ ok: true, value: { movementStandard: null } });
  });

  it('accepts only finite unit-correct scores and integer positive reps', () => {
    for (const [metric, unit] of Object.entries(GROUP_METRIC_UNITS)) {
      expect(isGroupMetricValue({ metric, unit, value: 8 })).toBe(true);
    }
    for (const value of [NaN, Infinity, -1, 0]) expect(isGroupMetricValue({ metric: 'relative_strength', unit: 'x_bw', value })).toBe(false);
    expect(isGroupMetricValue({ metric: 'relative_strength', unit: 'kg', value: 1.2 })).toBe(false);
    expect(isGroupMetricValue({ metric: 'bodyweight_reps', unit: 'reps', value: 8.5 })).toBe(false);
    expect(isGroupMetricValue({ metric: 'bodyweight_reps', unit: 'reps', value: 0 })).toBe(false);
    expect(isGroupMetricValue({ metric: 'bodyweight_reps', value_kg: 8 })).toBe(false);
  });

  it('matches explicit movement/loading standards without comparing personal coefficients', () => {
    expect(checkGroupLinkCompatibility(source, pull)).toEqual({ compatible: true, externalLoadFactor: 1 });
    expect(checkGroupLinkCompatibility(source, { ...pull, bodyweightCoefficient: 0.7 }))
      .toEqual({ compatible: true, externalLoadFactor: 1 });
    expect(checkGroupLinkCompatibility({ ...source, movementStandard: 'Kipping pull-up' }, pull))
      .toEqual({ compatible: false, reason: 'movement_standard' });
    expect(checkGroupLinkCompatibility({ ...source, loadingMethod: 'Band' }, pull))
      .toEqual({ compatible: false, reason: 'loading_method' });
    expect(checkGroupLinkCompatibility({ ...source, metadataKnown: false }, pull))
      .toEqual({ compatible: false, reason: 'metadata_unknown' });
    expect(checkGroupLinkCompatibility({ ...source, loadInputMode: 'per_side_load' }, pull))
      .toEqual({ compatible: true, externalLoadFactor: 2 });
    expect(checkGroupLinkCompatibility(source, { ...pull, loadInputMode: 'per_side_load' }))
      .toEqual({ compatible: true, externalLoadFactor: 0.5 });
  });
});
