import { estimateOneRepMax } from '../../src/exercise-calculations';
import { latentRirFromRecorded, normalCdf, seededRandom } from './residual-regression-research';
import type { RegimeSession } from './segmented-curve-research';

export const regimeScenarios = ['constant', 'linear', 'quadratic', 'step5', 'step10', 'small-step',
  'noise-shift', 'accuracy-shift', 'asymmetric', 'wide', 'false-zero', 'serial', 'session-fatigue',
  'missing', 'sparse', 'gap', 'zero-only', 'one-only', 'high-reps', 'rounding', 'tau-boundary',
  'p-zero', 'p-one', 'late-break', 'weekly'] as const;
export type RegimeScenario = typeof regimeScenarios[number];
export function generateRegimeHistory(scenario: RegimeScenario, seed: number) {
  if (!regimeScenarios.includes(scenario) || !Number.isSafeInteger(seed)) throw new Error('invalid simulation');
  const random = seededRandom(seed), sessions: RegimeSession[] = [];
  let serial = random.normal();
  const delta = scenario === 'step5' ? 5 : scenario === 'step10' ? 10 : scenario === 'small-step' ? 2 : 0;
  const cut = scenario === 'late-break' ? 26 : 16;
  for (let i = 0; i < 32; i++) {
    serial = 0.8 * serial + 0.6 * random.normal();
    let rir = scenario === 'zero-only' ? 0 : scenario === 'one-only' ? 1 : Math.floor(random.uniform() * 5);
    if (scenario === 'wide') rir = 2 + i % 3;
    const p = scenario === 'p-zero' ? 0 : scenario === 'p-one' ? 1 : scenario === 'accuracy-shift' && i >= 16 ? 0 : 0.5;
    let actual = latentRirFromRecorded(rir, p, scenario === 'serial' ? normalCdf(serial) : random.uniform());
    if (scenario === 'asymmetric' && actual !== rir) actual = rir + 1;
    if (scenario === 'wide' && actual !== rir) actual = rir + (actual < rir ? -2 : 2);
    if (scenario === 'false-zero' && actual > 0 && random.uniform() < 0.2) rir = 0;
    const reps = scenario === 'high-reps' ? [8, 12, 15][i % 3] : [2, 4, 6][i % 3];
    const strength = 100 + (scenario === 'linear' ? i * 0.3 : scenario === 'quadratic' ? 0.02 * (i - 16) ** 2
      : scenario === 'late-break' ? (i >= cut ? 10 : 0) : i >= cut ? delta : 0);
    const tau = scenario === 'tau-boundary' ? 9 : scenario === 'noise-shift' && i >= 16 ? 5 : 2.5;
    const predicted = strength / estimateOneRepMax(1, reps + actual)!;
    let load: number;
    do { load = predicted + tau * (scenario === 'serial' ? serial : random.normal())
      + (scenario === 'session-fatigue' ? 2 * random.normal() : 0); } while (load < 0);
    if (scenario === 'rounding') load = Math.round(load / 2.5) * 2.5;
    if (scenario === 'sparse' && i % 3 === 0) continue;
    sessions.push({ sessionId: `s${i}`, time: i + (scenario === 'gap' && i >= cut ? 16 : 0),
      firstWorkingSet: { setId: `set${i}`, reps, rir: scenario === 'missing' && i % 3 === 0 ? null : rir, load } });
  }
  return { sessions, trueCut: cut, delta: scenario === 'late-break' ? 10 : delta,
    strengthBefore: 100, strengthAfter: 100 + (scenario === 'late-break' ? 10 : delta),
    trueBoundary: scenario === 'gap' ? [15, 32] : [cut - 1, cut] };
}

export function monteCarloRate(successes: number, total: number) {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(successes) || successes < 0 || successes > total)
    throw new Error('invalid Monte Carlo count');
  const rate = successes / total;
  return { successes, total, rate, standardError: Math.sqrt(rate * (1 - rate) / total) };
}

// Calibrated relative evidence scaling, never a probability or visibility gate.
export function likelihoodEmphasis(evidence: number, reference: number) {
  if (!Number.isFinite(evidence) || evidence < 0 || !Number.isFinite(reference) || reference <= 0)
    throw new Error('invalid evidence scale');
  return evidence === 0 ? 0 : 1 / (1 + reference / evidence);
}
