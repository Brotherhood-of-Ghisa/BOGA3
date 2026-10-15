import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fitStrengthRegimes, type RegimeSession } from '../../../apps/mobile/__tests__/helpers/segmented-curve-research.ts';
import { seededRandom, latentRirFromRecorded } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
const rows = [];
for (const method of ['fixed', 'joint'] as const) {
  const random = seededRandom(37101);
  const sessions: RegimeSession[] = Array.from({ length: 32 }, (_, i) => {
    const rir = i % 5, actual = latentRirFromRecorded(rir, 0.5, random.uniform());
    return { sessionId: `s${i}`, time: i, firstWorkingSet: { setId: `set${i}`, reps: 4, rir,
      load: (i < 16 ? 100 : 112) / estimateOneRepMax(1, 4 + actual)! + 2.5 * random.normal() } };
  });
  const start = performance.now(), fit = fitStrengthRegimes(sessions, { method });
  assert.ok(fit.candidate && Number.isFinite(fit.evidence));
  assert.equal(fit.cutProfile.length, 17);
  rows.push({ method, elapsedMs: performance.now() - start, status: fit.status, cut: fit.candidate.cutIndex,
    strengths: fit.candidate.controls, p: fit.candidate.correctProbability, tau: fit.candidate.loadSd,
    rawEvidence: fit.evidence, unresolvedFits: [...fit.noBreakFits, ...fit.cutProfile].filter(f => !f.converged || f.strengthBoundary || f.loadBoundary).length });
}
console.log(JSON.stringify({ seed: 37101, sessions: 32, truth: [100, 112], rows }, null, 2));
