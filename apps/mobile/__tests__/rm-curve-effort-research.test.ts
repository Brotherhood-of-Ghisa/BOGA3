import { estimateOneRepMax } from '@/src/exercise-calculations';
import { calculateSetMetrics, type SetMetricInput } from '@/src/exercise-calculations/load-metrics';
import { getSessionSetRir } from '@/src/exercise-calculations/effort-policy';
import { isWorkingSet } from '@/src/exercise-calculations/set-semantics';
import vectors from '@/src/exercise-calculations/load-metrics-vectors.json';

// Test-only reconstruction of the approved analytical assumption, not a runtime helper.
const reconstruct = (input: SetMetricInput) => {
  const actual = calculateSetMetrics(input);
  const rir = getSessionSetRir(input.setType);
  if (!actual.eligible || actual.load.status !== 'known' || rir === null || !isWorkingSet({
    weight: input.weightValue ?? '', reps: input.repsValue ?? '', setType: input.setType,
    performanceStatus: input.performanceStatus,
  }, input.effortPolicy)) return null;
  const equivalentReps = actual.reps + rir;
  if (!Number.isSafeInteger(equivalentReps) || equivalentReps <= 0) return null;
  const analyticalRm = estimateOneRepMax(actual.load.calculatedLoadKg, equivalentReps);
  if (analyticalRm === null || !Number.isFinite(analyticalRm)) return null;
  return { actual, rir, equivalentReps, analyticalRm };
};

const input: SetMetricInput = { policy: 'ordinary', loadInputMode: 'total_load',
  bodyweightContribution: 0, weightValue: '100', repsValue: '8', setType: 'rir_2' };

describe('RM curve analytical effort assumption through the existing kernel', () => {
  it.each(vectors)('preserves actual metrics and inverses normalized $name', vector => {
    const source = { ...vector, setType: 'rir_2' } as SetMetricInput;
    const normalized = reconstruct(source)!;
    expect(normalized.actual).toEqual(calculateSetMetrics(source));
    expect(normalized.equivalentReps).toBe(Number(vector.repsValue) + 2);
    const predictedTotal = normalized.analyticalRm / estimateOneRepMax(1, normalized.equivalentReps)!;
    if (!normalized.actual.eligible || normalized.actual.load.status !== 'known') throw new Error('bad vector');
    const factor = source.loadInputMode === 'per_side_load' ? 2 : 1;
    expect((predictedTotal - normalized.actual.load.bodyweightPartKg) / factor)
      .toBeCloseTo(normalized.actual.load.enteredWeightKg, 10);
  });

  it('keeps a raw single distinct from its positive-RIR equivalent', () => {
    const atZero = reconstruct({ ...input, repsValue: '1', setType: 'rir_0' })!;
    const atTwo = reconstruct({ ...input, repsValue: '1' })!;
    expect(atZero.analyticalRm).toBe(100);
    expect(atTwo.actual.estimatedOneRepMaxKg).toBe(100);
    expect(atTwo.equivalentReps).toBe(3);
    expect(atTwo.analyticalRm).toBe(estimateOneRepMax(100, 3));
    expect(atTwo.analyticalRm).toBeGreaterThan(100);
  });

  it.each([null, 'unknown', 'unspecified', 'rir_01', 'rir_-1', 'rir_1.5', 'warm_up', 'technique'])
    ('does not invent canonical RIR for %s', setType => {
      expect(reconstruct({ ...input, setType })).toBeNull();
      expect(calculateSetMetrics({ ...input, setType }).estimatedOneRepMaxKg)
        .toBe(calculateSetMetrics(input).estimatedOneRepMaxKg);
    });

  it('retains high RIR, rejects unsafe sums and does not apply the actual-reps cap to u', () => {
    expect(reconstruct({ ...input, setType: 'rir_7' })?.equivalentReps).toBe(15);
    expect(reconstruct({ ...input, repsValue: '999', setType: 'rir_1' })?.equivalentReps).toBe(1000);
    expect(reconstruct({ ...input, repsValue: '1', setType: `rir_${Number.MAX_SAFE_INTEGER}` })).toBeNull();
    expect(reconstruct({ ...input, repsValue: '1', setType: `rir_${Number.MAX_SAFE_INTEGER - 1}` })?.equivalentReps)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it('uses the current working policy and never reclassifies a reset RIR4 as Technique', () => {
    expect(reconstruct({ ...input, setType: 'rir_4' })?.equivalentReps).toBe(12);
    expect(reconstruct({ ...input, effortPolicy: { workingSetEfforts: ['rir_0'], volumeEfforts: ['rir_2'] } }))
      .toBeNull();
    expect(reconstruct({ ...input, setType: 'technique' })).toBeNull();
  });

  it('keeps zero valid and rejects invalid performance, actual values and analytical overflow', () => {
    expect(reconstruct({ ...input, weightValue: '' })?.analyticalRm).toBe(0);
    for (const performanceStatus of ['planned', 'unperformed', 'skipped'] as const) {
      expect(reconstruct({ ...input, performanceStatus })).toBeNull();
    }
    for (const repsValue of ['0', '2.5', '1000']) expect(reconstruct({ ...input, repsValue })).toBeNull();
    const extreme = { ...input, repsValue: '1', weightValue: `1${'0'.repeat(307)}` };
    expect(calculateSetMetrics(extreme).estimatedTotalOneRepMaxKg).toBe(1e307);
    expect(reconstruct(extreme)).toBeNull();
  });

  it('recovers a fixed capacity through different performed-rep/RIR pairs', () => {
    for (const [m, n] of [[8, 2], [6, 2], [4, 3], [8, 4]]) {
      const weightValue = String(100 / estimateOneRepMax(1, m + n)!);
      const result = reconstruct({ ...input, repsValue: String(m), setType: `rir_${n}`, weightValue })!;
      expect(result.analyticalRm).toBeCloseTo(100, 10);
      expect(result.actual.estimatedTotalOneRepMaxKg).toBe(estimateOneRepMax(Number(weightValue), m));
    }
  });
});
