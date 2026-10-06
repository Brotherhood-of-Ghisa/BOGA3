import {
  estimateOneRepMax,
  parseCalculationSet,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';
import { workingSetsOnly } from '@/src/exercise-calculations/analytics';

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
      expect(parseSetWeight('NaN')).toBeNull();
      expect(parseSetWeight('-5')).toBeNull();
      expect(parseSetWeight(null)).toBeNull();
      expect(parseSetWeight(undefined)).toBeNull();
    });

    it('rejects scientific notation that the UI input pattern would reject', () => {
      // The exercise page's weight input (set-logger.tsx) accepts only digits
      // with an optional decimal point. `Number('1e3')` is 1000, so this
      // pins the parser to reject inputs the UI itself wouldn't allow.
      expect(parseSetWeight('1e3')).toBeNull();
      expect(parseSetWeight('5E2')).toBeNull();
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
  it('pins the single-rep row of [[1rm.formula]] at full precision', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(82.5, 1)).toBe(82.5);
    expect(estimateOneRepMax(0, 1)).toBe(0);
  });

  it('applies [[1rm.formula]] from two reps', () => {
    expect(estimateOneRepMax(100, 2)).toBeCloseTo(100 * 100 / (48.8 + 53.8 * Math.exp(-0.15)), 10);
    expect(estimateOneRepMax(100, 2)).toBeCloseTo(105.146, 2);
  });

  it('matches Wathan values across a representative rep range', () => {
    // Reference: 1RM = 100·w / (48.8 + 53.8·e^(-0.075·r))
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.583, 2);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(134.748, 2);
    expect(estimateOneRepMax(100, 20)).toBeCloseTo(164.463, 2);
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

  it('returns numeric zero for zero weight and null for invalid inputs', () => {
    expect(estimateOneRepMax(0, 5)).toBe(0);
    expect(estimateOneRepMax(-1, 5)).toBeNull();
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(-1, 1)).toBeNull();
    expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(estimateOneRepMax(100, -1)).toBeNull();
    expect(estimateOneRepMax(100, 1.5)).toBeNull();
    expect(estimateOneRepMax(100, Number.POSITIVE_INFINITY)).toBeNull();
    expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(estimateOneRepMax(Number.NaN, 5)).toBeNull();
  });
});

describe('exercise calculations: workingSetsOnly', () => {
  it('keeps the confirmed, valid sets that are not warm-ups, in order', () => {
    const sets = [
      { id: 'warm', weightValue: '60', repsValue: '10', setType: 'warm_up' },
      { id: 'rir', weightValue: '100', repsValue: '5', setType: 'rir_1' },
      { id: 'untagged', weightValue: '', repsValue: '8', setType: null },
      { id: 'legacy', weightValue: '90', repsValue: '5' },
      { id: 'planned', weightValue: '100', repsValue: '5', setType: 'rir_0', performanceStatus: 'planned' as const },
      { id: 'invalid', weightValue: '100', repsValue: '0', setType: 'rir_0' },
    ];
    expect(workingSetsOnly(sets).map((set) => set.id)).toEqual(['rir', 'untagged', 'legacy']);
    expect(workingSetsOnly([sets[0]])).toEqual([]);
  });
});
