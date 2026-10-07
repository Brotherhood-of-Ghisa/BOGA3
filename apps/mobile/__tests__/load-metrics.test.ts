import { estimateOneRepMax } from '@/src/exercise-calculations';
import {
  calculateSetMetrics,
  resolveCalculatedLoad,
  summarizeVolume,
  sumVolume,
  type SetMetricInput,
} from '@/src/exercise-calculations/load-metrics';
import vectors from '@/src/exercise-calculations/load-metrics-vectors.json';

const pullUp: SetMetricInput = {
  policy: 'group',
  bodyWeightKg: 80,
  bodyweightContribution: 1,
  loadInputMode: 'total_load',
  weightValue: '20',
  repsValue: '8',
  setType: 'rir_1',
  performanceStatus: null,
};

describe('shared load metrics', () => {
  it.each(vectors)('$name', vector => {
    const result = calculateSetMetrics({ ...vector, performanceStatus: null } as SetMetricInput);
    expect(result.eligible).toBe(true);
    expect(result.load).toMatchObject({
      status: 'known',
      calculatedLoadKg: vector.calculatedLoadKg,
      perSideCalculatedLoadKg: vector.perSideCalculatedLoadKg,
    });
    expect(result.volumeKgReps).toBe(vector.volumeKgReps);
    expect(result.estimatedOneRepMaxKg).toBeCloseTo(vector.estimatedOneRepMaxKg, 9);
  });

  it('keeps the personal missing-reading fallback distinct from strict group scoring', () => {
    expect(resolveCalculatedLoad({ ...pullUp, policy: 'personal', bodyWeightKg: null })).toMatchObject({
      status: 'known', calculatedLoadKg: 20, bodyweightPartKg: 0,
    });
    expect(resolveCalculatedLoad({ ...pullUp, bodyWeightKg: null }))
      .toEqual({ status: 'missing', reason: 'body_weight_missing' });
  });

  it.each([
    [{ bodyWeightKg: -80 }, 'body_weight_invalid'],
    [{ bodyWeightKg: Number.POSITIVE_INFINITY }, 'body_weight_invalid'],
    [{ bodyweightContribution: Number.NaN }, 'contribution_invalid'],
    [{ bodyweightContribution: -0.1 }, 'contribution_invalid'],
    [{ bodyweightContribution: 1.1 }, 'contribution_invalid'],
    [{ loadInputMode: 'unknown' }, 'load_input_mode_invalid'],
  ] as const)('rejects invalid context %j', (change, reason) => {
    expect(resolveCalculatedLoad({ ...pullUp, ...change } as SetMetricInput))
      .toEqual({ status: 'invalid', reason });
  });

  it.each(['-1', '1e3', '12,5', 'NaN', 'Infinity', '.', ''])('rejects invalid Weight %j', weightValue => {
    expect(resolveCalculatedLoad({ ...pullUp, weightValue }))
      .toEqual({ status: 'invalid', reason: 'weight_invalid' });
  });

  it('uses ordinary Weight unchanged and ignores bodyweight inputs', () => {
    for (const bodyWeightKg of [null, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveCalculatedLoad({ ...pullUp, policy: 'ordinary', bodyWeightKg })).toMatchObject({
        status: 'known', calculatedLoadKg: 20, bodyweightPartKg: 0,
      });
    }
  });

  it('keeps planned and unperformed rows out of metrics', () => {
    for (const performanceStatus of ['planned', 'skipped', 'unperformed'] as const) {
      expect(calculateSetMetrics({ ...pullUp, performanceStatus })).toMatchObject({
        eligible: false, volumeKgReps: null, estimatedOneRepMaxKg: null,
      });
    }
  });

  it('canonicalizes blank Weight to zero only when reps are valid', () => {
    expect(calculateSetMetrics({ ...pullUp, weightValue: '' })).toMatchObject({
      eligible: true, volumeKgReps: 640,
    });
    expect(calculateSetMetrics({ ...pullUp, weightValue: '', repsValue: '' }).eligible).toBe(false);
  });

  it('reports complete and partial volume coverage without fabricating missing values', () => {
    const result = summarizeVolume([
      calculateSetMetrics(pullUp),
      calculateSetMetrics({ ...pullUp, bodyWeightKg: null }),
      calculateSetMetrics({ ...pullUp, bodyweightContribution: Number.NaN }),
      calculateSetMetrics({ ...pullUp, performanceStatus: 'planned' }),
    ]);
    expect(result).toEqual({ knownVolumeKgReps: 800, totalVolumeKgReps: null,
      eligibleSetCount: 3, knownSetCount: 1, missingSetCount: 1, invalidSetCount: 1,
      complete: false, overflow: false });
    expect(summarizeVolume([])).toMatchObject({ complete: true, totalVolumeKgReps: 0 });
  });

  it('sums the Volume of the sets whose load is known, leaving the rest out ([[copy.no-inline-explanation]])', () => {
    const personal: SetMetricInput = { ...pullUp, policy: 'personal' };
    expect(sumVolume([
      calculateSetMetrics(personal),
      calculateSetMetrics({ ...personal, loadInputMode: 'sideways' as SetMetricInput['loadInputMode'] }),
      calculateSetMetrics({ ...personal, bodyWeightKg: -1 }),
      calculateSetMetrics({ ...personal, bodyweightContribution: Number.NaN }),
    ])).toBe(800);
    expect(sumVolume([calculateSetMetrics({ ...personal, bodyweightContribution: 2 })])).toBe(0);
    expect(sumVolume([])).toBe(0);
    // Null only when the sum itself is not finite: each 6e307 set is finite.
    const huge = calculateSetMetrics({ ...personal, bodyweightContribution: 0, weightValue: `1${'0'.repeat(306)}`, repsValue: '60' });
    expect(huge.volumeKgReps).toBe(6e307);
    expect(sumVolume([huge, huge, huge])).toBeNull();
  });

  it('keeps the displayed 1RM in entered-Weight terms', () => {
    const result = calculateSetMetrics(pullUp);
    expect(result.estimatedTotalOneRepMaxKg).toBeCloseTo(estimateOneRepMax(100, 8)!, 10);
    expect(result.estimatedOneRepMaxKg).toBeCloseTo(estimateOneRepMax(100, 8)! - 80, 10);
  });

  it.each([
    ['total', 'total_load', 0.6],
    ['per-side', 'per_side_load', 1],
  ] as const)('keeps [[1rm.formula]] for a single in entered-Weight terms with %s bodyweight load', (_label, loadInputMode, contribution) => {
    const result = calculateSetMetrics({
      ...pullUp, policy: 'personal', loadInputMode, bodyweightContribution: contribution,
      weightValue: '22.5', repsValue: '1',
    });
    const factor = loadInputMode === 'per_side_load' ? 2 : 1;
    expect(result.estimatedTotalOneRepMaxKg).toBeCloseTo(contribution * 80 + factor * 22.5, 10);
    expect(result.estimatedOneRepMaxKg).toBeCloseTo(22.5, 10);
  });

  it('never emits infinite metrics from finite extreme raw values', () => {
    const result = calculateSetMetrics({ ...pullUp, weightValue: `1${'0'.repeat(307)}`, repsValue: '100' });
    expect(result).toMatchObject({ eligible: true,
      load: { status: 'invalid', reason: 'numeric_overflow' }, volumeKgReps: null });
  });
});
