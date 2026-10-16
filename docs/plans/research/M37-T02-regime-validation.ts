// Full cell runner: all cuts/models and declared prefixes; summaries retain failures.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { generateRegimeHistory, regimeScenarios, type RegimeScenario } from '../../../apps/mobile/__tests__/helpers/regime-reliability-research.ts';
import { fitStrengthRegimes } from '../../../apps/mobile/__tests__/helpers/segmented-curve-research.ts';
const [phase, name, flag] = process.argv.slice(2);
assert.ok(['calibration', 'evaluation', 'confirmation', 'holdout'].includes(phase));
assert.ok(regimeScenarios.includes(name as RegimeScenario));
assert.ok(flag === undefined || flag === '--quick');
const scenario = name as RegimeScenario, quick = flag === '--quick';
const matching = ['constant', 'linear', 'quadratic', 'step5', 'step10', 'small-step'].includes(scenario);
const replications = quick ? 6 : matching ? 400 : 200;
const prefixes = scenario === 'weekly' ? Array.from({ length: 17 }, (_, i) => i + 16) : [16, 24, 32];
const start = performance.now(), rows = [];
for (let replication = 0; replication < replications; replication++) {
  const seed = ({ calibration: 370000000, evaluation: 470000000, confirmation: 570000000, holdout: 670000000 }[phase]!) + regimeScenarios.indexOf(scenario) * 10000 + replication;
  const generated = generateRegimeHistory(scenario, seed);
  for (const method of ['fixed', 'joint'] as const) {
    const fits = prefixes.map(prefix => {
      const fit = fitStrengthRegimes(generated.sessions.filter(s => Number(s.sessionId.slice(1)) < prefix), { method });
      const valid = fit.status === 'fitted';
      return { prefix, status: fit.status, rawEvidence: fit.evidence,
        usableEvidence: valid ? fit.evidence ?? 0 : 0,
        fits: [...fit.noBreakFits, ...fit.cutProfile].length,
        warnings: [...fit.noBreakFits, ...fit.cutProfile].filter(f => !f.converged || f.strengthBoundary || f.loadBoundary).length,
        candidate: fit.candidate ? { strengths: fit.candidate.controls, p: fit.candidate.correctProbability,
          tau: fit.candidate.loadSd, left: fit.candidate.leftTime, right: fit.candidate.rightTime,
          logLikelihood: fit.candidate.logLikelihood } : null,
        profile: fit.cutProfile.map(c => ({ left: c.leftTime, right: c.rightTime, logLikelihood: c.logLikelihood })) };
    });
    assert.ok(fits.every(f => f.rawEvidence === null || Number.isFinite(f.rawEvidence)));
    rows.push({ seed, replication, method, truth: { before: generated.strengthBefore, after: generated.strengthAfter,
      delta: generated.delta, boundary: generated.trueBoundary }, fits });
  }
}
assert.equal(new Set(rows.filter(r => r.method === 'fixed').map(r => r.seed)).size, replications);
console.log(JSON.stringify({ schema: 'strength-regime-validation.v1', phase, scenario, quick, replications,
  prefixes, minimumSegment: 8, elapsedMs: performance.now() - start, rows }));
