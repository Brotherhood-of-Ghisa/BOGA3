import { generateRegimeHistory, likelihoodEmphasis, monteCarloRate, regimeScenarios } from './helpers/regime-reliability-research';
import { fitStrengthTrajectory, prepareRegimePoints } from './helpers/segmented-curve-research';

describe('regime reliability experiment design', () => {
  it('is seeded, validates all designs and preserves sampled-set missingness and gaps', () => {
    for (const scenario of regimeScenarios) {
      const generated = generateRegimeHistory(scenario, 37201);
      expect(generated).toEqual(generateRegimeHistory(scenario, 37201));
      expect(prepareRegimePoints(generated.sessions).every(p => p.load >= 0)).toBe(true);
    }
    expect(prepareRegimePoints(generateRegimeHistory('missing', 1).sessions)).toHaveLength(21);
    expect(generateRegimeHistory('sparse', 1).sessions).toHaveLength(21);
    expect(generateRegimeHistory('gap', 1).sessions[16].time).toBe(32);
    expect(generateRegimeHistory('step10', 1).delta).toBe(10);
    expect(() => generateRegimeHistory('constant', NaN)).toThrow();
  });
  it('fits fractional and negative strength changes without a minimum gap', () => {
    for (const increment of [-7, 0.25, 3.7]) {
      const points = prepareRegimePoints(Array.from({ length: 24 }, (_, i) => ({
        sessionId: `s${i}`, time: i, selectedSet: { setId: `set${i}`, reps: 1, rir: 0,
          load: 100 + (i >= 12 ? increment : 0) + (i % 2 ? 2 : -2) },
      })));
      const fit = fitStrengthTrajectory(points, 'step', { method: 'fixed' }, 12);
      expect(fit.converged).toBe(true);
      expect(fit.controls[1] - fit.controls[0]).toBeCloseTo(increment, 3);
    }
  });
  it('scales relative evidence monotonically with no probability or visibility threshold', () => {
    expect([0, 5, 10, 20].map(d => likelihoodEmphasis(d, 10))).toEqual([0, 1/3, 0.5, 2/3]);
    expect(likelihoodEmphasis(Number.MAX_VALUE, Number.MIN_VALUE)).toBe(1);
    expect(() => likelihoodEmphasis(-1, 10)).toThrow();
    expect(() => likelihoodEmphasis(1, 0)).toThrow();
  });
  it('keeps unconditional Monte Carlo denominators and measured sampling error', () => {
    expect(monteCarloRate(20, 400)).toEqual({ successes: 20, total: 400, rate: 0.05,
      standardError: Math.sqrt(0.05 * 0.95 / 400) });
    expect(monteCarloRate(0, 400).rate).toBe(0);
    expect(() => monteCarloRate(401, 400)).toThrow();
    expect(() => monteCarloRate(0, 0)).toThrow();
  });
});
