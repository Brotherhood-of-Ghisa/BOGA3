import { conditionalRirProbability, fitRegression, jointLogLikelihood, latentRirFromRecorded, latentRirStates,
  median, normalCdf, predict, researchBic, scanBreaks, seededRandom, sessionMedians } from './helpers/residual-regression-research.ts';

const times = Array.from({ length: 24 }, (_, time) => time);

describe('test-only session residual regression method checks', () => {
  it('weights sessions equally and refuses contradictory session times', () => {
    const sets = times.flatMap(time => [98, 99, 100].map(rm => ({ session: `s${time}`, time, value: rm - 100 })));
    const sessions = sessionMedians(sets);
    expect(sessions).toHaveLength(24);
    expect(sessions.every(row => row.value === -1)).toBe(true);
    expect(sessionMedians(sets.flatMap(row => [row, { ...row }]))).toEqual(sessions);
    expect(() => sessionMedians([{ session: 's', time: 0, value: 0 }, { session: 's', time: 1, value: 0 }])).toThrow();
    expect(() => median([])).toThrow();
  });

  it('uses elapsed time through gaps and leaves a free no-trend intercept', () => {
    const rows = [0, 1, 3, 7, 8, 11].map(time => ({ time, value: -1 + 2 * time }));
    const fit = fitRegression(rows, 'linear')!;
    expect(fit.coefficients[0]).toBeCloseTo(-1, 10);
    expect(fit.coefficients[1]).toBeCloseTo(2, 10);
    expect(predict(fit, { time: 12, value: 0 })).toBeCloseTo(23, 10);
    expect(fitRegression(rows.map(row => ({ ...row, value: -1 })), 'constant')!.coefficients[0]).toBeCloseTo(-1, 10);
    expect(researchBic(fit)).toBeNull();
  });

  it.each(['hinge', 'jump'] as const)('recovers a known %s without confusing slope and level changes', model => {
    const rows = times.map(time => ({ time, value: 2 + 0.3 * time +
      (model === 'hinge' ? 0.8 * Math.max(0, time - 11.5) : 5 * Number(time > 11.5)) }));
    const selected = scanBreaks(rows, 8).filter(fit => fit.model === model).sort((a, b) => a.rss - b.rss)[0];
    expect(selected.breakAt).toBe(11.5);
    expect(selected.coefficients[2]).toBeCloseTo(model === 'hinge' ? 0.8 : 5, 10);
    expect(scanBreaks(rows.slice(0, 15), 8)).toEqual([]);
    expect(() => scanBreaks(rows, 1)).toThrow();
  });

  it('rejects rank/confounding failures and does not split equal-time sessions', () => {
    expect(fitRegression(times.map(time => ({ time, value: time, covariates: [time] })), 'linear')).toBeNull();
    const phase = times.map(time => ({ time, value: 5 * Number(time >= 12), covariates: [Number(time >= 12)] }));
    expect(fitRegression(phase, 'jump', 11.5)).toBeNull();
    expect(fitRegression([{ time: NaN, value: 0 }, { time: 1, value: 1 }], 'constant')).toBeNull();
    expect(fitRegression([{ time: 0, value: 1 }], 'constant')).toBeNull();
    expect(scanBreaks(times.map(() => ({ time: 1, value: 1 })), 8)).toEqual([]);
  });

  it('retains a smooth no-break alternative and an observed gap instead of an exact jump date', () => {
    const curved = times.map(time => ({ time, value: 0.05 * time * time }));
    expect(fitRegression(curved, 'quadratic')!.rss).toBeLessThan(1e-20);
    const hinge = scanBreaks(curved, 8).filter(fit => fit.model === 'hinge').sort((a, b) => a.rss - b.rss)[0];
    expect(hinge.rss).toBeLessThan(fitRegression(curved, 'linear')!.rss);
    const gap = times.map(time => ({ time: time < 12 ? time : time + 20, value: 5 * Number(time >= 12) }));
    const jump = scanBreaks(gap, 8).filter(fit => fit.model === 'jump').sort((a, b) => a.rss - b.rss)[0];
    expect([jump.leftTime, jump.rightTime]).toEqual([11, 32]);
  });

  it('uses a conditional three-point distribution with exact logged zero and symmetric tails', () => {
    expect(latentRirStates(0)).toEqual([0]);
    expect(latentRirStates(1)).toEqual([0, 1, 2]);
    expect(latentRirStates(7)).toEqual([6, 7, 8]);
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(conditionalRirProbability(0, 0, p)).toBe(1);
      expect(conditionalRirProbability(0, 1, p)).toBe(0);
      for (const n of [1, 2, 4, 100]) {
        const weights = latentRirStates(n).map(r => conditionalRirProbability(n, r, p));
        expect(weights).toEqual([(1 - p) / 2, p, (1 - p) / 2]);
        expect(weights.reduce((a, b) => a + b, 0)).toBe(1);
        expect(conditionalRirProbability(n, n + 2, p)).toBe(0);
      }
    }
    expect(conditionalRirProbability(1, 0, 0.5)).toBe(0.25);
  });

  it('samples true RIR around the logged reading without clipping genuine failure at logged one', () => {
    expect([0, 0.2499, 0.25, 0.7499, 0.75, 0.9999].map(u => latentRirFromRecorded(1, 0.5, u)))
      .toEqual([0, 0, 1, 1, 2, 2]);
    expect([0, 0.5, 0.999].map(u => latentRirFromRecorded(0, 0, u))).toEqual([0, 0, 0]);
    expect(latentRirFromRecorded(7, 0, 0.9)).toBe(8);
    expect(latentRirFromRecorded(1, 1, 0)).toBe(1);
    const a = seededRandom(20261015), b = seededRandom(20261015), counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) {
      const u = a.uniform();
      if (i < 20) expect(u).toBe(b.uniform());
      counts[latentRirFromRecorded(1, 0.5, u)]++;
    }
    [0.25, 0.5, 0.25].forEach((p, i) => expect(Math.abs(counts[i] / 20000 - p)).toBeLessThan(0.015));
  });

  it('rejects invalid probabilities, readings and draws before applying the exact-zero exception', () => {
    for (const p of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => conditionalRirProbability(0, 0, p)).toThrow();
      expect(() => latentRirFromRecorded(0, p, 0.5)).toThrow();
    }
    for (const u of [-1, 1, NaN]) expect(() => latentRirFromRecorded(0, 0.5, u)).toThrow();
    for (const n of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => latentRirStates(n)).toThrow();
    expect(() => conditionalRirProbability(1, -1, 0.5)).toThrow();
  });

  it('scores the conditional load mixture without an extra latent-RIR prior factor', () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 8);
    const point = { load: 10, recordedRir: 1, multipliers: [1, 2, 4] };
    const cdfs = [0.9999683287581669, 0.9772498680518208, 0.8413447460685429];
    const expected = [20, 10, 5].reduce((sum, mean, i) => sum + [0.25, 0.5, 0.25][i]
      * Math.exp(-(((10 - mean) / 5) ** 2) / 2) / (5 * Math.sqrt(2 * Math.PI) * cdfs[i]), 0);
    expect(jointLogLikelihood([point], 20, 0.5, 5)).toBeCloseTo(Math.log(expected), 10);
    expect(() => jointLogLikelihood([point], 20, 0.5, 0)).toThrow();
    expect(() => jointLogLikelihood([{ ...point, multipliers: [1, 2] }], 20, 0.5, 5)).toThrow();
    expect(() => jointLogLikelihood([{ ...point, load: -1 }], 20, 0.5, 5)).toThrow();
  });
});
