import { boundedSearch } from './helpers/bounded-research-search';
import { conditionalTrajectoryLikelihood, jointLogLikelihood, latentRirFromRecorded, seededRandom } from './helpers/residual-regression-research';
import { fitStrengthRegimes, fitStrengthTrajectory, prepareRegimePoints, type RegimeSession } from './helpers/segmented-curve-research';
import { resolveCalculatedLoad } from '@/src/exercise-calculations/load-metrics';
import { estimateOneRepMax } from '@/src/exercise-calculations';

const sessions = (strength: (i: number) => number, n = 24): RegimeSession[] => Array.from({ length: n }, (_, i) => ({
  sessionId: `s${String(i).padStart(2, '0')}`, time: i,
  firstWorkingSet: { setId: `set${i}`, reps: 1, rir: 0, load: strength(i) + (i % 2 ? 2 : -2) },
}));

describe('bounded research optimizer', () => {
  it('recovers an independently known interior and physical boundary optimum', () => {
    const objective = (x: number[]) => (x[0] - 0.3) ** 2 + 3 * (x[1] + 2) ** 2;
    const fit = boundedSearch(objective, [0.8, 0], [[0, 1], [-4, 4]]);
    expect(fit.converged).toBe(true); expect(fit.x[0]).toBeCloseTo(0.3, 4); expect(fit.x[1]).toBeCloseTo(-2, 4);
    const boundary = boundedSearch(x => (x[0] + 1) ** 2, [0.5], [[0, 1]]);
    expect(boundary.converged).toBe(true); expect(boundary.x[0]).toBe(0);
    expect(boundedSearch(objective, [0.8, 0], [[0, 1], [-4, 4]], 1).converged).toBe(false);
    expect(() => boundedSearch(objective, [], [])).toThrow();
    expect(() => boundedSearch(objective, [1], [[1, 1]])).toThrow();
  });
});

describe('conditional strength trajectory likelihood', () => {
  it('equals independent scalar scoring at each strength, including zero loads and physical p endpoints', () => {
    const points = prepareRegimePoints(sessions(i => 100 + i).slice(0, 3));
    points[1] = { ...points[1], load: 0, recordedRir: 1, multipliers: [1, 1.1, 1.2] };
    const score = conditionalTrajectoryLikelihood(points);
    for (const p of [0, 0.5, 1]) {
      const strengths = [2, 7, 100];
      const expected = points.reduce((sum, point, i) => sum + jointLogLikelihood([point], strengths[i], p, 5), 0);
      expect(score(strengths, p, 5)).toBeCloseTo(expected, 10);
    }
    expect(() => score([100], 0.5, 2.5)).toThrow();
    expect(() => score([1, 0, 1], 0.5, 2.5)).toThrow();
    expect(() => score([1, 1, 1], 1.1, 2.5)).toThrow();
    expect(() => score([1, 1, 1], 0.5, 0)).toThrow();
  });

  it('selects first ordinals supplied by the caller and never substitutes missing effort', () => {
    const input = sessions(() => 100, 4);
    input[0].firstWorkingSet!.rir = null; input[1].firstWorkingSet = null;
    expect(prepareRegimePoints(input).map(p => p.setId)).toEqual(['set2', 'set3']);
    expect(() => prepareRegimePoints([input[2], input[2]])).toThrow();
    expect(() => prepareRegimePoints([{ ...input[2], time: NaN }])).toThrow();
    expect(() => prepareRegimePoints([{ ...input[2], firstWorkingSet: { ...input[2].firstWorkingSet!, load: -1 } }])).toThrow();
    const zero = { ...input[2], firstWorkingSet: { ...input[2].firstWorkingSet!, load: 0 } };
    expect(prepareRegimePoints([zero])[0].load).toBe(0);
    expect(() => prepareRegimePoints([{ ...zero, firstWorkingSet: { ...zero.firstWorkingSet, rir: Number.MAX_SAFE_INTEGER } }])).toThrow();
  });
});

describe('direct segmented strength fitting', () => {
  it('recovers known Gaussian means and log likelihood without changing the RM kernel', () => {
    const input = sessions(i => i < 12 ? 100 : 110);
    const fit = fitStrengthRegimes(input, { method: 'fixed' });
    expect(fit.status).toBe('fitted'); expect(fit.candidate!.cutIndex).toBe(12);
    expect(fit.candidate!.controls[0]).toBeCloseTo(100, 3); expect(fit.candidate!.controls[1]).toBeCloseTo(110, 3);
    const expected = -24 * Math.log(2.5 * Math.sqrt(2 * Math.PI)) - 24 * 4 / (2 * 2.5 ** 2);
    expect(fit.candidate!.logLikelihood).toBeCloseTo(expected, 7);
    expect(fit.evidence).toBeGreaterThan(10);
    expect(fit.cutProfile).toHaveLength(9);
    expect(fit.points.map(p => p.setId)).toEqual(input.map(s => s.firstWorkingSet!.setId));
    expect(input[0].firstWorkingSet!.load).toBe(98);
  });

  it('allows linear and smooth curved progress to explain apparent separation', () => {
    for (const strength of [(i: number) => 100 + 0.5 * i, (i: number) => 100 + 0.02 * (i - 12) ** 2]) {
      const fit = fitStrengthRegimes(sessions(strength), { method: 'fixed' });
      expect(fit.status).toBe('fitted'); expect(fit.evidence).toBe(0);
      expect(fit.bestNoBreak!.kind).not.toBe('constant');
    }
  });

  it('jointly estimates one shared load scale and suppresses uninformed RIR accuracy', () => {
    const points = prepareRegimePoints(sessions(i => i < 12 ? 100 : 110));
    const fit = fitStrengthTrajectory(points, 'step', { method: 'joint' }, 12);
    expect(fit.converged).toBe(true); expect(fit.controls[0]).toBeCloseTo(100, 3);
    expect(fit.controls[1]).toBeCloseTo(110, 3); expect(fit.loadSd).toBeCloseTo(2, 3);
    expect(fit.correctProbability).toBeNull(); expect(fit.loadBoundary).toBe(false);
  });

  it('scores both regimes with the same fitted p/tau on mixed RIR data', () => {
    const random = seededRandom(37101);
    const input: RegimeSession[] = Array.from({ length: 24 }, (_, i) => {
      const rir = 1 + i % 3, r = latentRirFromRecorded(rir, 0.5, random.uniform());
      return { sessionId: `session${i}`, time: i, firstWorkingSet: { setId: `set${i}`, reps: 6, rir,
        load: (i < 12 ? 100 : 115) / estimateOneRepMax(1, 6 + r)! + 2.5 * random.normal() } };
    });
    const points = prepareRegimePoints(input), fit = fitStrengthTrajectory(points, 'step', { method: 'joint' }, 12);
    expect(fit.converged).toBe(true); expect(fit.correctProbability).not.toBeNull();
    expect(fit.correctProbability!).toBeGreaterThanOrEqual(0); expect(fit.correctProbability!).toBeLessThanOrEqual(1);
    const expected = jointLogLikelihood(points.slice(0, 12), fit.controls[0], fit.correctProbability!, fit.loadSd)
      + jointLogLikelihood(points.slice(12), fit.controls[1], fit.correctProbability!, fit.loadSd);
    expect(fit.logLikelihood).toBeCloseTo(expected, 9);
  });

  it('keeps whole-session gap bounds and is invariant to input order and time units', () => {
    const input = sessions(i => i < 12 ? 100 : 110).map((s, i) => ({ ...s, time: s.time + (i >= 12 ? 20 : 0) }));
    const fit = fitStrengthRegimes(input, { method: 'fixed' });
    expect(fit.candidate!.leftTime).toBe(11); expect(fit.candidate!.rightTime).toBe(32);
    const shifted = fitStrengthRegimes(input.slice().reverse().map(s => ({ ...s, time: 1700000000000 + s.time * 86400000 })), { method: 'fixed' });
    expect(shifted.candidate!.cutIndex).toBe(fit.candidate!.cutIndex);
    expect(shifted.evidence).toBeCloseTo(fit.evidence!, 7);
  });

  it('retains total/per-side load parity outside the former synthetic strength range', () => {
    const input = sessions(i => i < 12 ? 250 : 270);
    const normalized = input.map(s => {
      const result = resolveCalculatedLoad({ policy: 'ordinary', bodyweightContribution: 0,
        loadInputMode: 'per_side_load', weightValue: String(s.firstWorkingSet!.load / 2) });
      if (result.status !== 'known') throw new Error('invalid test load');
      return { ...s, firstWorkingSet: { ...s.firstWorkingSet!, load: result.calculatedLoadKg } };
    });
    const expected = fitStrengthRegimes(input, { method: 'fixed' });
    expect(fitStrengthRegimes(normalized, { method: 'fixed' })).toEqual(expected);
    expect(expected.candidate!.controls[0]).toBeCloseTo(250, 3);
    expect(expected.candidate!.controls[1]).toBeCloseTo(270, 3);
    const limited = fitStrengthTrajectory(prepareRegimePoints(input), 'step', { method: 'joint', loadSdBounds: [0.5, 1] }, 12);
    expect(limited.loadBoundary).toBe(true);
  });

  it('abstains on rank-deficient time designs and continuous positivity boundaries', () => {
    const uneven = sessions(() => 100, 25).map((s, i) => ({ ...s, time: i < 2 ? i : 1e12 }));
    const rank = fitStrengthRegimes(uneven, { method: 'fixed' });
    expect(rank.status).toBe('insufficient');
    expect(rank.noBreakFits.find(f => f.kind === 'quadratic')!.converged).toBe(false);
    expect(rank.noBreakFits.find(f => f.kind === 'quadratic')!.rankDeficient).toBe(true);
    const vertex = sessions(() => 100, 25).map((s, i) => ({ ...s,
      firstWorkingSet: { ...s.firstWorkingSet!, load: 100 * (i / 24 - 0.5) ** 2 } }));
    const fit = fitStrengthRegimes(vertex, { method: 'fixed' });
    expect(fit.status).toBe('unresolved');
    expect(fit.noBreakFits.find(f => f.kind === 'quadratic')!.strengthBoundary).toBe(true);
    expect(fit.noBreakFits.every(f => Number.isFinite(f.logLikelihood))).toBe(true);
    const overflow = sessions(() => Number.MAX_VALUE, 16);
    overflow[0].firstWorkingSet!.reps = 10;
    expect(() => fitStrengthRegimes(overflow, { method: 'fixed' })).toThrow('nonfinite');
  });

  it('reports insufficient, unresolved and zero-load boundaries rather than inventing a break', () => {
    expect(fitStrengthRegimes([], { method: 'fixed' }).status).toBe('insufficient');
    expect(fitStrengthRegimes(sessions(() => 100, 12), { method: 'fixed' }).candidate).toBeNull();
    expect(fitStrengthRegimes(sessions(i => i < 12 ? 100 : 110), { method: 'fixed', maxIterations: 1 }).status).toBe('unresolved');
    const zeros = sessions(() => 0, 16).map(s => ({ ...s, firstWorkingSet: { ...s.firstWorkingSet!, load: 0 } }));
    const fit = fitStrengthRegimes(zeros, { method: 'fixed' });
    expect(fit.status).toBe('unresolved'); expect(fit.candidate!.strengthBoundary).toBe(true);
    const tied = sessions(() => 100, 16).map(s => ({ ...s, time: 1 }));
    expect(fitStrengthRegimes(tied, { method: 'fixed' }).candidate).toBeNull();
    expect(() => fitStrengthRegimes(zeros, { method: 'fixed', correctProbability: 2 })).toThrow();
    expect(() => fitStrengthRegimes(zeros, { method: 'joint', loadSdBounds: [0, 2] })).toThrow();
  });
});
