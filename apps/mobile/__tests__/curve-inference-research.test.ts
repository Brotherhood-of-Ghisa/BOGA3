import { estimateOneRepMax } from '@/src/exercise-calculations';
import { jointLikelihoodGrid, jointLogLikelihood } from './helpers/residual-regression-research';
import { correctProbabilitySet, DEFAULT_ENTRY_LOAD_SD_KG, jointUncertaintyProfiles, prefixBreakMaximum, profileContains, profileSet,
  rirCurveMultipliers, searchedBreak, upperQuantile } from './helpers/curve-inference-research';
import { projectCurveHistory, type CurveHistoryRow } from './helpers/curve-history-research';

describe('research amplitude/error comparison', () => {
  it('scales per-side uncertainty once and preserves bodyweight/loading parity in the joint model', () => {
    const base: CurveHistoryRow = { owner: 'test', exercise: 'test', gym: 'gym', session: 'session', block: 'block', id: 'total',
      startedAt: 1, completedAt: 2, status: 'completed', deleted: false, weightValue: '80', repsValue: '6', setType: 'rir_2',
      performanceStatus: null, loadInputMode: 'total_load', bodyweightContribution: 0.25, bodyweightEnabled: true, bodyWeightKg: 80 };
    const points = projectCurveHistory([base, { ...base, id: 'side', weightValue: '40', loadInputMode: 'per_side_load' }]).points;
    expect(points.map(p => p.load)).toEqual([100, 100]);
    expect(points.map(p => p.factor * DEFAULT_ENTRY_LOAD_SD_KG[p.row.loadInputMode])).toEqual([2.5, 2.5]);
    expect(DEFAULT_ENTRY_LOAD_SD_KG.per_side_load).toBe(1.25);
    const inputs = points.map(p => ({ load: p.load, recordedRir: p.rir,
      multipliers: rirCurveMultipliers(p.reps, p.rir) }));
    expect(jointUncertaintyProfiles([inputs[0]], [100, 110], [0, 0.5, 1], [1.25, 2.5, 5]))
      .toEqual(jointUncertaintyProfiles([inputs[1]], [100, 110], [0, 0.5, 1], [1.25, 2.5, 5]));
  });

  it('profiles correct-reading probability and load uncertainty using the same scalar likelihood', () => {
    const points = [{ load: 80, recordedRir: 1, multipliers: rirCurveMultipliers(6, 1) },
      { load: 85, recordedRir: 2, multipliers: rirCurveMultipliers(6, 2) }];
    const strengths = [95, 100, 105], probabilities = [0, 0.5, 1], loads = [1.25, 2.5, 5];
    const fit = jointUncertaintyProfiles(points, strengths, probabilities, loads);
    loads.forEach((loadSd, k) => probabilities.forEach((probability, i) => strengths.forEach((s, j) =>
      expect(fit.cube[k][i][j]).toBeCloseTo(jointLogLikelihood(points, s, probability, loadSd), 10))));
    expect(fit.positiveRirObservations).toBe(2);
    const grid = jointLikelihoodGrid(points, strengths, probabilities, 2.5);
    expect(grid).toEqual(fit.cube[1]);
    expect(() => jointUncertaintyProfiles(points, strengths, probabilities, [])).toThrow();
    expect(() => jointLikelihoodGrid(points, strengths, [1.01], 2.5)).toThrow();
  });

  it('keeps exact-zero load uncertainty while suppressing an uninformed accuracy estimate', () => {
    const multipliers = rirCurveMultipliers(6, 0), load = 100 / multipliers[0];
    const points = [-2.5, 0, 2.5].map(error => ({ load: load + error, recordedRir: 0, multipliers }));
    const fit = jointUncertaintyProfiles(points, [95, 100, 105], [0, 0.5, 1], [1.25, 2.5, 5]);
    expect(fit.positiveRirObservations).toBe(0);
    expect(fit.correctProfile.every(score => score === fit.correctProfile[0])).toBe(true);
    expect(correctProbabilitySet([0, 0.5, 1], fit.correctProfile, 4)).toBeNull();
    expect(profileSet([95, 100, 105], fit.strengthProfile, 0)!.estimate).toBe(100);
    expect(jointLogLikelihood(points, 100, 0, 2.5)).toBe(jointLogLikelihood(points, 100, 1, 2.5));
    expect(fit.loadProfile.every(Number.isFinite)).toBe(true);
    const copies = Array.from({ length: 4 }, () => ({ ...points[0], load }));
    const repeated = jointUncertaintyProfiles(copies, [95, 100, 105], [0, 0.5, 1], [1.25, 2.5, 5]);
    expect(profileSet([1.25, 2.5, 5], repeated.loadProfile, 0)!.lowerBoundary).toBe(true);
  });

  it('allows logged one to include actual failure and preserves the adopted single-rep branch', () => {
    expect(rirCurveMultipliers(1, 1)).toEqual([1, estimateOneRepMax(1, 2), estimateOneRepMax(1, 3)]);
    const points = [{ load: 2, recordedRir: 0, multipliers: rirCurveMultipliers(1, 0) }];
    const grid = jointLikelihoodGrid(points, [1, 2, 3], [0, 0.5, 1], 1);
    expect(grid[0][1]).toBeCloseTo(-Math.log(Math.sqrt(2 * Math.PI)) - Math.log(0.9772498680518208), 8);
    expect(grid[0]).toEqual(grid[2]);
    expect(() => rirCurveMultipliers(0, 1)).toThrow();
    expect(() => rirCurveMultipliers(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => rirCurveMultipliers(1, Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it('suppresses flat accuracy profiles for positive readings when the adopted kernel saturates', () => {
    const multipliers = rirCurveMultipliers(6, 10000);
    expect(new Set(multipliers).size).toBe(1);
    const fit = jointUncertaintyProfiles([{ load: 100 / multipliers[0], recordedRir: 10000, multipliers }],
      [95, 100, 105], [0, 0.5, 1], [1.25, 2.5, 5]);
    expect(fit.positiveRirObservations).toBe(1);
    expect(correctProbabilitySet([0, 0.5, 1], fit.correctProfile, 4)).toBeNull();
    expect(profileSet([95, 100, 105], fit.strengthProfile, 0)!.estimate).toBe(100);
  });

  it('treats accuracy endpoints as physical bounds rather than unresolved infinite limits', () => {
    const profile = correctProbabilitySet([0, 0.5, 1], [-4, -1, 0], 4)!;
    expect(profile.upperBoundary).toBe(true);
    expect(profile.components).toEqual([{ lower: 1 / 3, upper: 1 }]);
    const lower = correctProbabilitySet([0, 0.5, 1], [0, -1, -4], 4)!;
    expect(lower.lowerBoundary).toBe(true);
    expect(lower.components[0].lower).toBe(0);
    expect(lower.components[0].upper).toBeCloseTo(2 / 3, 10);
    expect(correctProbabilitySet([0, 0.5, 1], [0, 0, 0], 4)).toBeNull();
    expect(() => correctProbabilitySet([0.1, 0.5, 0.9], [0, 1, 0], 4)).toThrow();
    expect(correctProbabilitySet([0, 1], [-Infinity, -Infinity], 4)).toBeNull();
  });

  it('preserves disconnected profile sets, off-grid coverage and unresolved search boundaries', () => {
    const profile = profileSet([80, 90, 100, 110, 120], [0, -10, -1, -10, -20], 4)!;
    expect(profile.components).toEqual([{ lower: null, upper: 82 }, { lower: 98.88888888888889, upper: 101.11111111111111 }]);
    expect(profileContains(profile, 100.35)).toBe(true);
    expect(profileContains(profile, 95)).toBe(false);
    expect(profile.lowerBoundary).toBe(true);
    expect(profileSet([1, 2], [-1, 0], 4)!.components).toEqual([{ lower: null, upper: null }]);
    expect(() => profileSet([1, 1], [0, 0], 4)).toThrow();
    expect(() => profileSet([1], [NaN], 4)).toThrow();
  });

  it('counts the complete model/cut/prefix search and abstains when segments or residual variance are insufficient', () => {
    const rows = Array.from({ length: 24 }, (_, time) => ({ time, value: 100 + 0.2 * time + 8 * Number(time > 11.5) + (time % 3 - 1) * 0.1 }));
    const scan = searchedBreak(rows)!;
    expect(scan.fit.model).toBe('jump');
    expect(scan.fit.breakAt).toBe(11.5);
    expect(prefixBreakMaximum(rows, [12, 16, 24])).toBeGreaterThanOrEqual(scan.statistic);
    expect(searchedBreak(rows.slice(0, 12))).toBeNull();
    expect(searchedBreak(rows.map(row => ({ ...row, value: 100 })))).toBeNull();
    expect(() => prefixBreakMaximum(rows, [25])).toThrow();
    expect(upperQuantile([1, 2, 3, 4], 0.8)).toBe(4);
    expect(() => upperQuantile([], 0.95)).toThrow();
  });
});
