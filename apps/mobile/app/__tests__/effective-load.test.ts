import {
  calculateEffectiveSetMetrics,
  estimateExternalLoad,
  isBodyweightRepsEligible,
  KG_PER_LB,
  resistanceAtReps,
  resolveEffectiveLoad,
  summarizeEffectiveVolume,
  type EffectiveSetInput,
} from '@/src/exercise-calculations/effective-load';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { isWorkingSessionSetType } from '@/src/data/set-types';
import vectors from '@/src/exercise-calculations/effective-load-vectors.json';

const pullUp: EffectiveSetInput = {
  bodyWeightKg: 80, bodyweightCoefficient: 1, loadInputMode: 'total_load',
  weightValue: '20', weightUnit: 'kg', externalLoadMode: 'added', repsValue: '8',
  setType: 'rir_1', performanceStatus: null,
};

describe('shared effective-load vectors', () => {
  it.each(vectors)('$name', (vector) => {
    const result = calculateEffectiveSetMetrics(vector);
    expect(result.eligible).toBe(true);
    expect(result.load).toMatchObject({
      status: 'known', resistanceKg: vector.resistanceKg,
      muscleResistancePerSideKg: vector.muscleResistancePerSideKg,
    });
    expect(result.volumeKgReps).toBe(vector.volumeKgReps);
    if (vector.estimatedOneRepMaxKg === null) expect(result.estimatedOneRepMaxKg).toBeNull();
    else expect(result.estimatedOneRepMaxKg).toBeCloseTo(vector.estimatedOneRepMaxKg, 9);
  });

  it('normalizes pounds without modifying original strings or units', () => {
    const input = { ...pullUp, weightValue: '  20.00 ', weightUnit: 'lb' };
    const original = { ...input };
    const result = resolveEffectiveLoad(input);
    expect(result.status).toBe('known');
    if (result.status !== 'known') throw new Error('Expected normalized pounds');
    expect(result.enteredWeightKg).toBeCloseTo(9.0718474, 10);
    expect(result.resistanceKg).toBeCloseTo(89.0718474, 10);
    expect(input).toEqual(original);
  });

  it.each([
    [{ bodyWeightKg: null }, 'missing', 'body_weight_missing'],
    [{ bodyWeightKg: 0 }, 'invalid', 'body_weight_invalid'],
    [{ bodyWeightKg: -80 }, 'invalid', 'body_weight_invalid'],
    [{ bodyWeightKg: Infinity }, 'invalid', 'body_weight_invalid'],
    [{ bodyweightCoefficient: NaN }, 'invalid', 'coefficient_invalid'],
    [{ bodyweightCoefficient: -0.1 }, 'invalid', 'coefficient_invalid'],
    [{ bodyweightCoefficient: 1.1 }, 'invalid', 'coefficient_invalid'],
    [{ weightUnit: 'oz' }, 'invalid', 'unit_invalid'],
    [{ weightUnit: null }, 'invalid', 'unit_invalid'],
    [{ loadInputMode: 'unknown' }, 'invalid', 'load_input_mode_invalid'],
    [{ externalLoadMode: 'unknown' }, 'invalid', 'external_load_mode_invalid'],
    [{ externalLoadMode: null }, 'missing', 'legacy_interpretation'],
    [{ externalLoadMode: 'unquantified_assistance' }, 'missing', 'unquantified_assistance'],
    [{ externalLoadMode: 'assistance', weightValue: '81' }, 'invalid', 'negative_resistance'],
    [{ bodyweightCoefficient: 0, externalLoadMode: 'assistance' }, 'invalid', 'assistance_requires_bodyweight'],
  ] as const)('keeps unavailable load explicit: %j', (patch, status, reason) => {
    expect(resolveEffectiveLoad({ ...pullUp, ...patch })).toEqual({ status, reason });
  });

  it.each(['-1', '1e3', '12,5', 'NaN', 'Infinity', '.', ''])('retains the decimal parser policy for %j', weightValue => {
    expect(resolveEffectiveLoad({ ...pullUp, weightValue })).toEqual({ status: 'invalid', reason: 'amount_invalid' });
  });

  it('ignores irrelevant body weight for conventional load metrics', () => {
    for (const bodyWeightKg of [null, 0, NaN, Infinity]) {
      expect(resolveEffectiveLoad({ ...pullUp, bodyweightCoefficient: 0, bodyWeightKg })).toMatchObject({
        status: 'known', resistanceKg: 20, resistanceBasis: 'entered_load',
      });
    }
  });
});

describe('performance eligibility and coverage', () => {
  it.each(['planned', 'skipped', 'unperformed'] as const)('does not promote %s values into performed metrics', performanceStatus => {
    expect(calculateEffectiveSetMetrics({ ...pullUp, performanceStatus })).toMatchObject({
      eligible: false, volumeKgReps: null, estimatedOneRepMaxKg: null,
    });
  });

  it('canonicalizes blank logger weight only with valid reps', () => {
    expect(calculateEffectiveSetMetrics({ ...pullUp, weightValue: '' })).toMatchObject({ eligible: true, volumeKgReps: 640 });
    expect(calculateEffectiveSetMetrics({ ...pullUp, weightValue: '', repsValue: '' }).eligible).toBe(false);
  });

  it('keeps reps and the existing effort classification when body weight is missing', () => {
    const result = calculateEffectiveSetMetrics({ ...pullUp, bodyWeightKg: null });
    expect(result).toMatchObject({ eligible: true, reps: 8, volumeKgReps: null, estimatedOneRepMaxKg: null });
    expect(isWorkingSessionSetType(pullUp.setType)).toBe(true);
    expect(isWorkingSessionSetType('warm_up')).toBe(false);
    expect(calculateEffectiveSetMetrics({ ...pullUp, setType: 'warm_up' }).volumeKgReps).toBe(800);
    expect(calculateEffectiveSetMetrics({ ...pullUp, setType: 'rir_8' }).estimatedOneRepMaxKg)
      .toBe(calculateEffectiveSetMetrics(pullUp).estimatedOneRepMaxKg);
  });

  it('reports a subtotal and complete coverage independently, including empty and zero-load aggregates', () => {
    const result = summarizeEffectiveVolume([
      calculateEffectiveSetMetrics(pullUp),
      calculateEffectiveSetMetrics({ ...pullUp, bodyWeightKg: null }),
      calculateEffectiveSetMetrics({ ...pullUp, weightValue: '81', externalLoadMode: 'assistance' }),
      calculateEffectiveSetMetrics({ ...pullUp, performanceStatus: 'planned' }),
    ]);
    expect(result).toEqual({ knownVolumeKgReps: 800, totalVolumeKgReps: null, eligibleSetCount: 3,
      knownSetCount: 1, missingSetCount: 1, invalidSetCount: 1, complete: false, overflow: false });
    expect(summarizeEffectiveVolume([])).toMatchObject({ complete: true, totalVolumeKgReps: 0 });
    expect(summarizeEffectiveVolume([calculateEffectiveSetMetrics({ ...pullUp, weightValue: '80', externalLoadMode: 'assistance' })]))
      .toMatchObject({ complete: true, totalVolumeKgReps: 0, knownSetCount: 1 });
  });

  it('keeps unweighted reps independent of B but requires a compatible, resolved unassisted performance', () => {
    const set = { ...pullUp, bodyWeightKg: null, weightValue: '0' };
    expect(isBodyweightRepsEligible(set, true)).toBe(true);
    expect(isBodyweightRepsEligible(set, false)).toBe(false);
    for (const patch of [
      { weightValue: '20' }, { externalLoadMode: 'unquantified_assistance' },
      { externalLoadMode: null }, { performanceStatus: 'planned' as const }, { weightUnit: 'unknown' },
    ]) expect(isBodyweightRepsEligible({ ...set, ...patch }, true)).toBe(false);
  });

  it('never emits infinite metrics from finite but extreme raw values', () => {
    const result = calculateEffectiveSetMetrics({ ...pullUp, weightValue: `1${'0'.repeat(307)}`, repsValue: '100' });
    expect(result).toMatchObject({ eligible: true, load: { status: 'invalid', reason: 'numeric_overflow' }, volumeKgReps: null });
    const largeSet = calculateEffectiveSetMetrics({ ...pullUp, weightValue: `1${'0'.repeat(306)}`, repsValue: '50' });
    expect(summarizeEffectiveVolume([largeSet, largeSet, largeSet, largeSet])).toMatchObject({
      complete: false, overflow: true, totalVolumeKgReps: null, knownVolumeKgReps: null,
    });
  });
});

describe('strength ordering and projections', () => {
  it('reverses equal-rep absolute and relative order, and cancels B for unweighted relative scores', () => {
    const light = calculateEffectiveSetMetrics({ ...pullUp, bodyWeightKg: 60, repsValue: '5' });
    const heavy = calculateEffectiveSetMetrics({ ...pullUp, bodyWeightKg: 90, repsValue: '5' });
    expect(light.estimatedOneRepMaxKg).toBeLessThan(heavy.estimatedOneRepMaxKg!);
    expect(light.relativeEstimatedOneRepMax).toBeGreaterThan(heavy.relativeEstimatedOneRepMax!);
    const unweighted = [60, 90].map(bodyWeightKg => calculateEffectiveSetMetrics({ ...pullUp, bodyWeightKg, weightValue: '0' }));
    expect(unweighted[0].relativeEstimatedOneRepMax).toBeCloseTo(unweighted[1].relativeEstimatedOneRepMax!, 12);
  });

  it.each([1, 2, 5, 8, 15, 50, 200])('exactly inverts Wathan at %i reps without changing its one-rep convention', reps => {
    const estimate = estimateOneRepMax(100, reps)!;
    expect(resistanceAtReps(estimate, reps)).toBeCloseTo(100, 10);
    expect(estimate).toBeLessThan(100 * 100 / 48.8);
  });

  it('projects capacity at the target B while preserving historical score and B', () => {
    const source = calculateEffectiveSetMetrics(pullUp);
    const project = (bodyWeightKg: number) => estimateExternalLoad({
      ...pullUp, bodyWeightKg, weightUnit: 'kg', oneRepConvention: 'capacity',
      targetReps: 1, estimatedOneRepMaxKg: source.estimatedOneRepMaxKg!,
    });
    expect(project(80)).toMatchObject({ status: 'known', externalLoadMode: 'added', enteredAmount: 47.671419080453734 });
    expect(project(82)).toMatchObject({ status: 'known', externalLoadMode: 'added', enteredAmount: 45.671419080453734 });
    expect(source.estimatedOneRepMaxKg).toBeCloseTo(127.671419080454, 10);
    expect(pullUp.bodyWeightKg).toBe(80);
    const exact = estimateExternalLoad({ ...pullUp, weightUnit: 'kg', oneRepConvention: 'exact_inverse',
      targetReps: 1, estimatedOneRepMaxKg: source.estimatedOneRepMaxKg! });
    if (exact.status !== 'known') throw new Error('Expected exact projection');
    expect(exact.enteredAmount).toBeLessThan(47.671419080453734);
    expect(estimateOneRepMax(exact.predictedResistanceKg, 1)).toBeCloseTo(source.estimatedOneRepMaxKg!, 10);
  });

  it('returns positive assistance amounts without clamping, rounding or scaling B twice', () => {
    const projected = estimateExternalLoad({ ...pullUp, loadInputMode: 'per_side_load',
      weightUnit: 'lb', oneRepConvention: 'capacity', targetReps: 1, estimatedOneRepMaxKg: 60 });
    expect(projected).toMatchObject({ status: 'known', externalLoadMode: 'assistance',
      predictedResistanceKg: 60, totalExternalAdjustmentKg: -20, enteredAmount: 10 / KG_PER_LB });
    if (projected.status !== 'known') throw new Error('Expected assistance projection');
    expect(resolveEffectiveLoad({ ...pullUp, loadInputMode: 'per_side_load', weightUnit: projected.weightUnit,
      weightValue: String(projected.enteredAmount), externalLoadMode: projected.externalLoadMode }))
      .toMatchObject({ status: 'known', resistanceKg: 60 });
  });

  it('rejects invalid projection input and missing target B', () => {
    const input = { ...pullUp, weightUnit: 'kg' as const, oneRepConvention: 'capacity' as const,
      targetReps: 5, estimatedOneRepMaxKg: 100 };
    expect(estimateExternalLoad({ ...input, bodyWeightKg: null })).toEqual({ status: 'missing', reason: 'body_weight_missing' });
    for (const targetReps of [0, -1, 1.5, Infinity]) {
      expect(estimateExternalLoad({ ...input, targetReps }).status).toBe('invalid');
    }
    expect(estimateExternalLoad({ ...input, estimatedOneRepMaxKg: 0 }).status).toBe('invalid');
  });
});
