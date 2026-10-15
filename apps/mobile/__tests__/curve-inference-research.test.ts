import { estimateOneRepMax } from '@/src/exercise-calculations';
import { jointLikelihoodGrid, jointLogLikelihood } from './helpers/residual-regression-research';
import { DEFAULT_ENTRY_LOAD_SD_KG, jointUncertaintyProfiles, prefixBreakMaximum, profileContains, profileSet,
  searchedBreak, upperQuantile } from './helpers/curve-inference-research';
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
      multipliers: Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, p.reps + r)!) }));
    expect(jointUncertaintyProfiles([inputs[0]], [100, 110], [0, 1, 2], [1.25, 2.5, 5]))
      .toEqual(jointUncertaintyProfiles([inputs[1]], [100, 110], [0, 1, 2], [1.25, 2.5, 5]));
  });

  it('profiles load uncertainty and RIR uncertainty with the same scalar likelihood, retaining both boundaries', () => {
    const points = [{ load: 95, recordedRir: 0, multipliers: [1] }, { load: 105, recordedRir: 0, multipliers: [1] }];
    const strengths = [95, 100, 105], rirs = [0, 1], loads = [1.25, 2.5, 5];
    const fit = jointUncertaintyProfiles(points, strengths, rirs, loads);
    loads.forEach((loadSd, k) => rirs.forEach((rirSd, i) => strengths.forEach((s, j) =>
      expect(fit.cube[k][i][j]).toBeCloseTo(jointLogLikelihood(points, s, rirSd, loadSd), 8))));
    expect(profileSet(strengths, fit.strengthProfile, 0)!.estimate).toBe(100);
    expect(profileSet(loads, fit.loadProfile, 0)!.estimate).toBe(5);
    expect(profileSet(loads, fit.loadProfile, 0)!.upperBoundary).toBe(true);
    const copies = Array.from({ length: 4 }, () => ({ ...points[0], load: 100 }));
    const repeated = jointUncertaintyProfiles(copies, strengths, rirs, loads);
    expect(profileSet(loads, repeated.loadProfile, 0)!.lowerBoundary).toBe(true);
    expect(() => jointUncertaintyProfiles(points, strengths, rirs, [])).toThrow();
    expect(() => jointUncertaintyProfiles(points, strengths, rirs, [0])).toThrow();
  });

  it('anchors failure-set strength while leaving RIR dispersion unidentified and load discrepancy nonzero', () => {
    const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
    const load = 100 / multipliers[0];
    const points = [-2.5, 0, 2.5].map(error => ({ load: load + error, recordedRir: 0, multipliers }));
    const fit = jointUncertaintyProfiles(points, [95, 100, 105], [0, 0.5, 1, 2], [1.25, 2.5, 5]);
    expect(fit.positiveRirObservations).toBe(0);
    expect(fit.sigmaProfile.every(score => score === fit.sigmaProfile[0])).toBe(true);
    expect(profileSet([95, 100, 105], fit.strengthProfile, 0)!.estimate).toBe(100);
    expect(jointLogLikelihood(points, 100, 0, 2.5)).toBe(jointLogLikelihood(points, 100, 5, 2.5));
    // The prior mass of r=0 is constant; a failure reading cannot be explained by another latent RIR.
    const singles = points.map(point => ({ ...point, multipliers: [multipliers[0]] }));
    expect(jointLogLikelihood(points, 100, 1, 2.5)).toBeCloseTo(
      jointLogLikelihood(singles, 100, 1, 2.5) - points.length * Math.log(5), 10);
    expect(fit.loadProfile.every(Number.isFinite)).toBe(true);
  });

  it('retains the adopted single-rep amplitude and scores a truncated Gaussian with a known latent RIR', () => {
    expect(estimateOneRepMax(1, 1)).toBe(1);
    const points = [{ load: 2, recordedRir: 0, multipliers: [1] }];
    const grid = jointLikelihoodGrid(points, [1, 2, 3], [0, 1], 1);
    expect(grid[0][1]).toBeCloseTo(-Math.log(Math.sqrt(2 * Math.PI)) - Math.log(0.9772498680518208), 8);
    expect(grid[0][1]).toBeGreaterThan(grid[0][0]);
    expect(grid[0][1]).toBeGreaterThan(grid[0][2]);
  });

  it('factors the same likelihood for high-RIR observations without dropping impossible sigma-zero fits', () => {
    const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
    const points = [{ load: 80, recordedRir: 100, multipliers }, { load: 85, recordedRir: 2, multipliers }];
    const strengths = [90, 100, 110], sds = [0, 0.25, 1, 2];
    const grid = jointLikelihoodGrid(points, strengths, sds, 1);
    sds.forEach((sd, i) => strengths.forEach((s, j) => expect(grid[i][j]).toBeCloseTo(jointLogLikelihood(points, s, sd, 1), 8)));
    expect(grid[0]).toEqual([-Infinity, -Infinity, -Infinity]);
    expect(profileSet(strengths, grid[0], 4)).toBeNull();
    expect(() => jointLikelihoodGrid(points, [], sds, 1)).toThrow();
    expect(() => jointLikelihoodGrid(points, strengths, sds, 0)).toThrow();
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
