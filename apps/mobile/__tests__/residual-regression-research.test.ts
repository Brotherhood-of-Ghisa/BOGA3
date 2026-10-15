import { estimateOneRepMax } from '@/src/exercise-calculations';
import { fitRegression, jointLogLikelihood, median, normalCdf, predict, recordedRirFromLatent,
  recordedRirLogProbability, recordedRirProbability, researchBic, scanBreaks,
  seededRandom, sessionMedians } from './helpers/residual-regression-research.ts';

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

  it('reproduces forward RIR noise with exact failure, a positive boundary and no upper clamp', () => {
    const a = seededRandom(20261013), b = seededRandom(20261013);
    const draws = Array.from({ length: 20 }, () => a.normal());
    expect(draws).toEqual(Array.from({ length: 20 }, () => b.normal()));
    expect(draws.map(draw => recordedRirFromLatent(2, 0, draw))).toEqual(Array(20).fill(2));
    expect(recordedRirFromLatent(0, 1, -2)).toBe(0);
    expect(recordedRirFromLatent(0, 5, 100)).toBe(0);
    expect(recordedRirFromLatent(1, 5, -100)).toBe(1);
    expect(recordedRirFromLatent(4, 1, 3)).toBe(7);
    expect(recordedRirFromLatent(2, 1, 0.6)).toBe(3);
    for (const sd of [-1, NaN, Infinity]) expect(() => recordedRirFromLatent(2, sd, 0)).toThrow();
    expect(() => recordedRirFromLatent(-1, 1, 0)).toThrow();
    expect(() => recordedRirFromLatent(Number.MAX_SAFE_INTEGER, 2, 1)).toThrow();
  });

  it('normalizes exact-zero and positive reporting distributions, with independently known boundary probabilities', () => {
    for (const sd of [0, 0.25, 1, 5]) {
      expect(recordedRirProbability(0, 0, sd)).toBe(1);
      for (const latent of [1, 2, 4]) {
        expect(recordedRirLogProbability(0, latent, sd)).toBe(-Infinity);
        expect(recordedRirLogProbability(latent, 0, sd)).toBe(-Infinity);
        const total = Array.from({ length: 101 }, (_, n) => recordedRirProbability(n, latent, sd))
          .reduce((sum, probability) => sum + probability, 0);
        expect(total).toBeCloseTo(1, 10);
      }
    }
    // Independent standard-normal CDF values at +/-0.5, not generated by this helper.
    expect(recordedRirProbability(1, 1, 1)).toBeCloseTo(0.6914624612740131, 10);
    expect(recordedRirProbability(1, 2, 1)).toBeCloseTo(0.3085375387259869, 10);
    const random = seededRandom(918273);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) {
      const n = recordedRirFromLatent(1, 1, random.normal());
      counts[Math.min(n, 2)]++;
    }
    expect(counts[0]).toBe(0);
    expect(Math.abs(counts[1] / 20000 - 0.6914624612740131)).toBeLessThan(0.015);
  });

  it('scores a declared joint strength/RIR candidate without attributing load mismatch entirely to RIR', () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 8);
    expect(recordedRirProbability(0, 0, 1)).toBeGreaterThan(recordedRirProbability(1, 0, 1));
    expect(Array.from({ length: 20 }, (_, n) => recordedRirProbability(n, 2, 1)).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 8);
    const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
    const points = [{ load: 100 / multipliers[2], recordedRir: 2, multipliers }];
    expect(jointLogLikelihood(points, 100, 0, 0.2)).toBeGreaterThan(jointLogLikelihood(points, 105, 0, 0.2));
    expect(Number.isFinite(jointLogLikelihood(points, 100, 1, 0.2))).toBe(true);
    expect(() => jointLogLikelihood(points, 100, 1, 0)).toThrow();
    expect(() => jointLogLikelihood([{ ...points[0], multipliers: [0] }], 100, 1, 1)).toThrow();
  });

  it('retains Gaussian high-RIR tails and scores them in log space', () => {
    const probability = recordedRirProbability(7, 4, 0.25);
    expect(probability).toBeGreaterThan(0);
    expect(probability / 7.619853024160593e-24).toBeCloseTo(1, 10);
    const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
    const high = [{ load: 100 / multipliers[4], recordedRir: 7, multipliers }];
    expect(Number.isFinite(jointLogLikelihood(high, 100, 0.25, 0.2))).toBe(true);
    expect(jointLogLikelihood(high, 100, 0, 0.2)).toBe(-Infinity);
    expect(recordedRirProbability(100, 4, 0.25)).toBe(0);
    expect(Number.isFinite(recordedRirLogProbability(100, 4, 0.25))).toBe(true);
    expect(Number.isFinite(jointLogLikelihood([{ ...high[0], recordedRir: 100 }], 100, 0.25, 0.2))).toBe(true);
  });
});
