import { estimateOneRepMax } from '@/src/exercise-calculations';
import { jointLikelihoodGrid, jointLogLikelihood } from './helpers/residual-regression-research';
import { prefixBreakMaximum, profileContains, profileSet, searchedBreak, upperQuantile } from './helpers/curve-inference-research';

describe('research amplitude/error comparison', () => {
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
