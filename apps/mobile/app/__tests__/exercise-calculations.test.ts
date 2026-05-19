import {
  computeExerciseVolume,
  computeMaxRepsByWeight,
  computeSetVolume,
  estimateExerciseOneRepMax,
  estimateOneRepMax,
  parseCalculationSet,
  parseSetReps,
  parseSetWeight,
  type CalculationSetInput,
} from '@/src/exercise-calculations';

const set = (
  weightValue: string,
  repsValue: string,
  setType: CalculationSetInput['setType'] = null
): CalculationSetInput => ({ weightValue, repsValue, setType });

describe('exercise calculations: parsing', () => {
  describe('parseSetWeight', () => {
    it('parses decimal and whitespace-padded numbers', () => {
      expect(parseSetWeight('100')).toBe(100);
      expect(parseSetWeight('  42.5  ')).toBe(42.5);
      expect(parseSetWeight('0')).toBe(0);
    });

    it('rejects empty, non-numeric, or negative values', () => {
      expect(parseSetWeight('')).toBeNull();
      expect(parseSetWeight('   ')).toBeNull();
      expect(parseSetWeight('abc')).toBeNull();
      expect(parseSetWeight('-5')).toBeNull();
      expect(parseSetWeight(null)).toBeNull();
      expect(parseSetWeight(undefined)).toBeNull();
    });
  });

  describe('parseSetReps', () => {
    it('parses positive integer strings', () => {
      expect(parseSetReps('1')).toBe(1);
      expect(parseSetReps('  12 ')).toBe(12);
    });

    it('rejects zero, decimals, negatives, and non-numeric input', () => {
      expect(parseSetReps('0')).toBeNull();
      expect(parseSetReps('5.5')).toBeNull();
      expect(parseSetReps('-3')).toBeNull();
      expect(parseSetReps('abc')).toBeNull();
      expect(parseSetReps('')).toBeNull();
      expect(parseSetReps(null)).toBeNull();
    });
  });

  describe('parseCalculationSet', () => {
    it('returns null when either field is invalid', () => {
      expect(parseCalculationSet({ weightValue: '', repsValue: '5' })).toBeNull();
      expect(parseCalculationSet({ weightValue: '100', repsValue: '0' })).toBeNull();
    });

    it('preserves set type when provided, defaults to null otherwise', () => {
      expect(parseCalculationSet({ weightValue: '100', repsValue: '5', setType: 'warm_up' })).toEqual({
        weight: 100,
        reps: 5,
        setType: 'warm_up',
      });
      expect(parseCalculationSet({ weightValue: '100', repsValue: '5' })).toEqual({
        weight: 100,
        reps: 5,
        setType: null,
      });
    });
  });
});

describe('exercise calculations: estimateOneRepMax (Wathan)', () => {
  it('returns weight itself within ~1.5% at one rep', () => {
    const estimate = estimateOneRepMax(100, 1) as number;
    expect(estimate).toBeCloseTo(101.32, 1);
    expect(estimate / 100).toBeGreaterThan(1.0);
    expect(estimate / 100).toBeLessThan(1.02);
  });

  it('matches Wathan values across a representative rep range', () => {
    // Reference: 1RM = 100·w / (48.8 + 53.8·e^(-0.075·r))
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.58, 1);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(134.75, 1);
    expect(estimateOneRepMax(100, 20)).toBeCloseTo(164.45, 1);
  });

  it('stays bounded as reps grow — does not balloon at high rep counts', () => {
    const asymptote = 100 / 48.8; // ~2.0492
    const at50 = estimateOneRepMax(100, 50) as number;
    const at200 = estimateOneRepMax(100, 200) as number;
    expect(at50 / 100).toBeLessThan(asymptote);
    expect(at200 / 100).toBeLessThan(asymptote);
    expect(at200 / 100).toBeGreaterThan(at50 / 100);
    expect(asymptote - at200 / 100).toBeLessThan(0.001);
  });

  it('is monotonically increasing in both weight and reps', () => {
    expect(estimateOneRepMax(100, 5)).toBeLessThan(estimateOneRepMax(100, 6) as number);
    expect(estimateOneRepMax(100, 5)).toBeLessThan(estimateOneRepMax(110, 5) as number);
  });

  it('returns 0 for zero weight and null for invalid inputs', () => {
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(-1, 5)).toBeNull();
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, 1.5)).toBeNull();
    expect(estimateOneRepMax(Number.NaN, 5)).toBeNull();
  });
});

describe('exercise calculations: computeSetVolume', () => {
  it('multiplies weight by reps', () => {
    expect(computeSetVolume(100, 5)).toBe(500);
    expect(computeSetVolume(42.5, 8)).toBe(340);
  });

  it('returns 0 for invalid or non-positive inputs', () => {
    expect(computeSetVolume(0, 5)).toBe(0);
    expect(computeSetVolume(100, 0)).toBe(0);
    expect(computeSetVolume(-100, 5)).toBe(0);
    expect(computeSetVolume(100, 1.5)).toBe(0);
  });
});

describe('exercise calculations: estimateExerciseOneRepMax', () => {
  it('returns the max per-set 1RM estimate across working sets', () => {
    const sets = [set('100', '5'), set('110', '3'), set('90', '8')];
    const expected = Math.max(
      estimateOneRepMax(100, 5) as number,
      estimateOneRepMax(110, 3) as number,
      estimateOneRepMax(90, 8) as number
    );
    expect(estimateExerciseOneRepMax(sets)).toBeCloseTo(expected, 5);
  });

  it('excludes warm-up sets by default', () => {
    const sets = [set('200', '1', 'warm_up'), set('100', '5')];
    expect(estimateExerciseOneRepMax(sets)).toBeCloseTo(
      estimateOneRepMax(100, 5) as number,
      5
    );
  });

  it('includes warm-up sets when explicitly requested', () => {
    const sets = [set('200', '1', 'warm_up'), set('100', '5')];
    expect(estimateExerciseOneRepMax(sets, { includeWarmUps: true })).toBeCloseTo(
      estimateOneRepMax(200, 1) as number,
      5
    );
  });

  it('ignores sets that fail to parse', () => {
    const sets = [set('', '5'), set('abc', '3'), set('100', '5')];
    expect(estimateExerciseOneRepMax(sets)).toBeCloseTo(
      estimateOneRepMax(100, 5) as number,
      5
    );
  });

  it('returns null when no eligible set is present', () => {
    expect(estimateExerciseOneRepMax([])).toBeNull();
    expect(estimateExerciseOneRepMax([set('100', '5', 'warm_up')])).toBeNull();
    expect(estimateExerciseOneRepMax([set('', '')])).toBeNull();
  });
});

describe('exercise calculations: computeExerciseVolume', () => {
  it('sums working-set volumes', () => {
    const sets = [set('100', '5'), set('110', '3'), set('90', '8')];
    expect(computeExerciseVolume(sets)).toBe(100 * 5 + 110 * 3 + 90 * 8);
  });

  it('excludes warm-up sets by default and includes them when opted in', () => {
    const sets = [set('40', '10', 'warm_up'), set('100', '5')];
    expect(computeExerciseVolume(sets)).toBe(500);
    expect(computeExerciseVolume(sets, { includeWarmUps: true })).toBe(40 * 10 + 500);
  });

  it('returns 0 for empty or fully invalid input', () => {
    expect(computeExerciseVolume([])).toBe(0);
    expect(computeExerciseVolume([set('', ''), set('abc', '5')])).toBe(0);
  });
});

describe('exercise calculations: computeMaxRepsByWeight', () => {
  it('returns the max reps per distinct weight, sorted weight descending', () => {
    const sets = [
      set('100', '5'),
      set('100', '8'),
      set('100', '6'),
      set('80', '10'),
      set('120', '3'),
    ];
    expect(computeMaxRepsByWeight(sets)).toEqual([
      { weight: 120, maxReps: 3 },
      { weight: 100, maxReps: 8 },
      { weight: 80, maxReps: 10 },
    ]);
  });

  it('excludes warm-up sets by default', () => {
    const sets = [set('100', '10', 'warm_up'), set('100', '5')];
    expect(computeMaxRepsByWeight(sets)).toEqual([{ weight: 100, maxReps: 5 }]);
  });

  it('includes warm-up sets when opted in', () => {
    const sets = [set('100', '10', 'warm_up'), set('100', '5')];
    expect(computeMaxRepsByWeight(sets, { includeWarmUps: true })).toEqual([
      { weight: 100, maxReps: 10 },
    ]);
  });

  it('ignores invalid sets and returns an empty list when nothing is eligible', () => {
    expect(computeMaxRepsByWeight([set('', '5'), set('100', '')])).toEqual([]);
    expect(computeMaxRepsByWeight([])).toEqual([]);
  });
});
