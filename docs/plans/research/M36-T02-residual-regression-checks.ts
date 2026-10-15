// Ephemeral numerical method checks; no production detector or reliability claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { calculateSetMetrics } from '../../../apps/mobile/src/exercise-calculations/load-metrics.ts';
import { getSessionSetRir } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { isWorkingSet } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { fitRegression, jointLogLikelihood, median, normalCdf, predict, latentRirFromRecorded, latentRirStates,
  conditionalRirProbability, RIR_REPORTING_MODEL, researchBic, scanBreaks, seededRandom, sessionMedians,
  type JointRirPoint, type ResearchRow } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { correctProbabilitySet, rirCurveMultipliers } from '../../../apps/mobile/__tests__/helpers/curve-inference-research.ts';

type WaveSet = {
  session: string; phase: string; week: number; set: number; startedAt: number; completedAt: number;
  reps: number; rir: number; weightValue: string; repsValue: string; setType: string;
  performanceStatus: null; gym: string; loadInputMode: 'total_load'; bodyweightContribution: number;
};
const source = readFileSync(new URL('../../../apps/mobile/__tests__/fixtures/rm-curve-weekly-wave.json', import.meta.url), 'utf8');
const fixture = JSON.parse(source) as { prior: WaveSet[]; scenarios: Record<string, WaveSet[]> };
const seed = 20261013;
const probabilityArgument = process.argv.slice(2);
assert.ok(probabilityArgument.length <= 1 && probabilityArgument.every(arg => /^--correct-probability=\d+(\.\d+)?$/.test(arg)), 'use --correct-probability=<probability from0 to1>');
const correctProbability = probabilityArgument.length ? Number(probabilityArgument[0].split('=')[1]) : 0.5;
assert.ok(Number.isFinite(correctProbability) && correctProbability >= 0 && correctProbability <= 1);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

const point = (row: WaveSet) => {
  const metric = calculateSetMetrics({ policy: 'ordinary', loadInputMode: row.loadInputMode,
    bodyweightContribution: row.bodyweightContribution, weightValue: row.weightValue,
    repsValue: row.repsValue, setType: row.setType, performanceStatus: row.performanceStatus });
  const n = getSessionSetRir(row.setType);
  if (!metric.eligible || metric.load.status !== 'known' || n === null || !isWorkingSet({
    weight: row.weightValue, reps: row.repsValue, setType: row.setType, performanceStatus: row.performanceStatus,
  })) return null;
  const u = metric.reps + n;
  if (!Number.isSafeInteger(u)) return null;
  const a = estimateOneRepMax(metric.load.calculatedLoadKg, u);
  return a === null || !Number.isFinite(a) ? null : { row, a, u };
};
const evaluationStart = fixture.scenarios.stable[0].startedAt;
function reference(rows: WaveSet[]): number | null {
  const sessions = new Map<string, { completedAt: number; best: number }>();
  for (const row of rows) {
    const p = point(row);
    if (!p || p.u > 10 || p.a <= 0 || row.completedAt >= evaluationStart || row.gym !== 'synthetic-gym') continue;
    const previous = sessions.get(row.session);
    sessions.set(row.session, { completedAt: row.completedAt, best: Math.max(p.a, previous?.best ?? 0) });
  }
  const selected = [...sessions.values()].sort((a, b) => b.completedAt - a.completedAt).slice(0, 6);
  return selected.length < 6 ? null : median(selected.map(row => row.best));
}
function observations(rows: WaveSet[], m: number | null, prefix = Infinity): ResearchRow[] {
  if (m === null) return [];
  return sessionMedians(rows.filter(row => row.week <= prefix).flatMap(row => {
    const p = point(row);
    return p ? [{ session: row.session, time: (row.startedAt - evaluationStart) / 604800000,
      value: 100 * (p.a / m - 1) }] : [];
  }));
}
const m = reference(fixture.prior)!;
close(m, 100);
assert.equal(reference(fixture.prior.filter(row => row.week !== -1)), null);
assert.equal(reference([...fixture.prior, ...fixture.scenarios.gradual]), m);
const stable = observations(fixture.scenarios.stable, m), gradual = observations(fixture.scenarios.gradual, m);
const plateau = observations(fixture.scenarios.plateau, m);
const stableFit = fitRegression(stable, 'constant')!, gradualFit = fitRegression(gradual, 'linear')!;
close(stableFit.coefficients[0], -1);
close(gradualFit.coefficients[0], -0.01);
close(gradualFit.coefficients[1], 0.99);
assert.ok(stableFit.rss < 1e-20 && gradualFit.rss < 1e-20);
assert.equal(researchBic(stableFit), null, 'no artificial BIC floor for a noiseless control');
for (let prefix = 1; prefix <= 24; prefix++) {
  assert.deepEqual(observations(fixture.scenarios.plateau, m, prefix),
    observations(fixture.scenarios.plateau.filter(row => row.week <= prefix), m, prefix));
}
assert.deepEqual(observations(fixture.scenarios.plateau, null), []);
assert.deepEqual(scanBreaks(plateau.slice(0, 15), 8), []);
const strength = fixture.scenarios.plateau.filter(row => row.phase === 'Strength' && row.set === 1).map(row => point(row)!);
close(strength[0].a, strength[1].a);
assert.ok(strength[1].a < strength[2].a && strength[2].a < strength[3].a);
close(strength[3].a, strength[4].a);
assert.ok(Number(strength[4].row.weightValue) > Number(strength[3].row.weightValue));
const rirOracle = [1, 2, 3].map(n => ({ n, analytical: estimateOneRepMax(80, 6 + n)!, actual: estimateOneRepMax(80, 6)! }));
rirOracle.forEach((row, i) => close(row.analytical, [99.22397105515728, 102.13713526436298, 104.99705194511593][i]));
close(rirOracle[0].actual, 96.26446402288299);

const times = Array.from({ length: 24 }, (_, time) => time);
const knownHinge = times.map(time => ({ time, value: 2 + 0.3 * time + 0.8 * Math.max(0, time - 11.5) }));
const knownJump = times.map(time => ({ time, value: 2 + 0.3 * time + 5 * Number(time > 11.5) }));
const best = (rows: ResearchRow[], kind: 'hinge' | 'jump') => scanBreaks(rows, 8)
  .filter(fit => fit.model === kind).sort((a, b) => a.rss - b.rss)[0];
close(best(knownHinge, 'hinge').breakAt!, 11.5);
close(best(knownHinge, 'hinge').coefficients[2], 0.8);
close(best(knownJump, 'jump').breakAt!, 11.5);
close(best(knownJump, 'jump').coefficients[2], 5);
assert.ok(best(knownHinge, 'jump').rss > 1 && best(knownJump, 'hinge').rss > 1);
const curved = times.map(time => ({ time, value: 0.05 * time * time }));
assert.ok(fitRegression(curved, 'quadratic')!.rss < 1e-20);
assert.ok(best(curved, 'hinge').rss < fitRegression(curved, 'linear')!.rss,
  'a visible kink fit can approximate a smooth no-break curve');
assert.equal(fitRegression(times.map(time => ({ time, value: time, covariates: [time] })), 'linear'), null);
const composition = times.map(time => ({ time, value: 4 * Number(time >= 12), covariates: [Number(time >= 12)] }));
assert.equal(fitRegression(composition, 'jump', 11.5), null, 'phase and jump cannot be separated');
const gap = times.map(time => ({ time: time < 12 ? time : time + 20, value: Number(time >= 12) * 5 }));
const gapFit = best(gap, 'jump');
assert.deepEqual([gapFit.leftTime, gapFit.rightTime], [11, 32]);
const irregular = [0, 1, 3, 7, 8, 11].map(time => ({ time, value: 3 + 2 * time }));
close(fitRegression(irregular, 'linear')!.coefficients[1], 2);

// Sets share a session draw; replicating each set never multiplies the session N.
const random = seededRandom(seed);
const dependentPoints = times.flatMap(time => {
  const shared = random.normal();
  return [-0.5, 0, 0.5].map(offset => ({ session: `s${time}`, time, value: shared + offset }));
});
const dependent = sessionMedians(dependentPoints);
assert.equal(dependent.length, 24);
assert.deepEqual(sessionMedians(dependentPoints.flatMap(row => [row, { ...row }, { ...row }])), dependent);
const nullFit = fitRegression(dependent, 'linear')!;
const profile = scanBreaks(dependent, 8);
const searchGain = Math.max(...profile.map(fit => nullFit.rss - fit.rss));
assert.ok(searchGain >= nullFit.rss - profile[0].rss);
const resampleRandom = seededRandom(seed + 1);
const searchExamples = Array.from({ length: 32 }, () => {
  const sample = dependent.map((row, i) => ({ time: row.time,
    value: nullFit.fitted[i] + nullFit.residuals[i] * (resampleRandom.uniform() < 0.5 ? -1 : 1) }));
  const fittedNull = fitRegression(sample, 'linear')!;
  return Math.max(...scanBreaks(sample, 8).map(fit => fittedNull.rss - fit.rss));
});
assert.ok(searchExamples.every(Number.isFinite));

// Condition on recorded effort; never perturb logged effort or substitute a latent-RIR prior.
const conditionalRirChecks = [0, 0.25, 0.5, 0.75, 1].flatMap(p => [0, 1, 2, 4, 100].map(recorded => {
  const states = latentRirStates(recorded), weights = states.map(r => conditionalRirProbability(recorded, r, p));
  close(weights.reduce((a, b) => a + b, 0), 1);
  const random = seededRandom(seed);
  const samples = Array.from({ length: 2000 }, () => latentRirFromRecorded(recorded, p, random.uniform()));
  assert.ok(samples.every(r => states.includes(r)));
  if (recorded === 0) assert.ok(samples.every(r => r === 0));
  return { correctProbability: p, recorded, states, weights,
    observedCounts: states.map(r => samples.filter(x => x === r).length) };
}));
assert.equal(latentRirFromRecorded(1, 0.5, 0.1), 0, 'logged one can be actual failure');
assert.equal(latentRirFromRecorded(0, 0, 0.9), 0);
const refSupport = (rows: WaveSet[]) => [...new Set(rows.filter(row => {
  const p = point(row); return p && p.a > 0 && p.u <= 10;
}).map(row => row.session))];
const plusOne = (rows: WaveSet[]) => rows.map(row => ({ ...row, rir: row.rir + 1, setType: `rir_${row.rir + 1}` }));
assert.equal(reference(plusOne(fixture.prior)), null, 'coupled +1 loses the two Volume sessions from reference support');
assert.equal(refSupport(plusOne(fixture.prior)).length, 4);
const supportedPlateau = observations(fixture.scenarios.plateau.filter(row => point(row)!.u <= 10), m);
assert.equal(supportedPlateau.length, 18, 'reset remains observed but does not enter this sensitivity fit');
close(supportedPlateau.find(row => row.time === 12)!.value, 2.6670345389279593);

const modelComparison = (rows: ResearchRow[]) => [
  ...( ['constant', 'linear', 'quadratic'] as const).map(model => fitRegression(rows, model)!),
  ...scanBreaks(rows, 8),
].map(fit => ({ model: fit.model, breakAt: fit.breakAt, rss: fit.rss, coefficients: fit.coefficients,
  parameterCountIncludingVarianceAndSearch: fit.coefficients.length + 1 + Number(fit.breakAt !== undefined),
  bicSensitivity: researchBic(fit) }));

// Rolling origins refit/search using only their training prefix; no future model selection.
const rolling = times.slice(16).map(index => {
  const training = gradual.slice(0, index), target = gradual[index];
  const candidates = (['constant', 'linear', 'quadratic'] as const).map(model => fitRegression(training, model)!)
    .concat(scanBreaks(training, 8));
  const errors = candidates.map(fit => ({ model: fit.model, breakAt: fit.breakAt, squaredError: (target.value - predict(fit, target)) ** 2 }));
  return { trainingSessions: index, targetTime: target.time, errors };
});
assert.ok(rolling.every(origin => origin.errors.find(row => row.model === 'linear')!.squaredError < 1e-20));

// The conditional load mixture retains the adopted kernel and a separate load-discrepancy scale.
close(normalCdf(0), 0.5);
assert.ok(Math.abs(normalCdf(1) - 0.8413447460685429) < 1e-9);
const jointRandom = seededRandom(seed + 4);
const jointPoints: JointRirPoint[] = Array.from({ length: 32 }, (_, index) => {
  const performed = [2, 4, 6][index % 3], recorded = [0, 1, 2, 4][index % 4];
  const latent = latentRirFromRecorded(recorded, correctProbability, jointRandom.uniform());
  return { multipliers: rirCurveMultipliers(performed, recorded), recordedRir: recorded,
    load: 100 / estimateOneRepMax(1, performed + latent)! + 0.2 * jointRandom.normal() };
});
const strengthGrid = Array.from({ length: 41 }, (_, index) => 90 + 0.5 * index);
const probabilityGrid = [0, 0.25, 0.5, 0.75, 1];
function jointProfile(points: JointRirPoint[], loadSd: number) {
  const candidates = strengthGrid.flatMap(strength => probabilityGrid.map(p => ({ strength, correctProbability: p,
    logLikelihood: jointLogLikelihood(points, strength, p, loadSd) }))).sort((a, b) => b.logLikelihood - a.logLikelihood);
  const maximum = candidates[0];
  const near = candidates.filter(row => row.logLikelihood >= maximum.logLikelihood - 2);
  const accuracyProfile = probabilityGrid.map(p => candidates.find(row => row.correctProbability === p)!);
  const identified = correctProbabilitySet(probabilityGrid, accuracyProfile.map(p => p.logLikelihood), 0);
  return { loadSd, correctUnidentified: identified === null,
    maximum: { ...maximum, correctProbability: identified?.estimate ?? null },
    fixedHalf: candidates.find(row => row.correctProbability === 0.5),
    descriptiveWithinTwoLogUnits: { count: near.length,
      strengthRange: [Math.min(...near.map(row => row.strength)), Math.max(...near.map(row => row.strength))],
      correctProbabilityRange: [Math.min(...near.map(row => row.correctProbability)), Math.max(...near.map(row => row.correctProbability))] },
    accuracyProfile };
}
const jointProfiles = [0.2, 1, 3].map(loadSd => jointProfile(jointPoints, loadSd));
assert.ok(Math.abs(jointProfiles[0].maximum.strength - 100) <= 1);
const repeated = Array.from({ length: 8 }, () => ({ load: 80, recordedRir: 2,
  multipliers: rirCurveMultipliers(6, 2) }));
const weakJointProfile = jointProfile(repeated, 3);
const exactMismatch = Math.min(...repeated[0].multipliers.flatMap(a => repeated[0].multipliers.map(b => Math.abs(80 * a - 81 * b))));
assert.ok(exactMismatch > 1e-6, 'two nearby loads need not share an exact common integer-RIR strength');

console.log(JSON.stringify({ seed, correctProbability, rirReportingModel: RIR_REPORTING_MODEL, fixtureSha256: createHash('sha256').update(source).digest('hex'),
  controls: { sessions: stable.length, baseline: m, stableIntercept: stableFit.coefficients[0],
    gradualInterceptAtTimeZero: gradualFit.coefficients[0], gradualSlope: gradualFit.coefficients[1] },
  rirOracle, knownHinge: best(knownHinge, 'hinge'), knownJump: best(knownJump, 'jump'),
  curvedNoBreak: { linearRss: fitRegression(curved, 'linear')!.rss, hingeRss: best(curved, 'hinge').rss,
    quadraticRss: fitRegression(curved, 'quadratic')!.rss },
  plateau: { sessionResiduals: plateau.map(row => row.value), modelComparison: modelComparison(plateau),
    supportedSessionCount: supportedPlateau.length, supportedWeek13Residual: supportedPlateau.find(row => row.time === 12)!.value,
    minimumSegmentSensitivity: [6, 8, 10].map(minimum => ({ minimum, candidateFits: scanBreaks(plateau, minimum).length })) },
  gap: { neighbouringTimes: [gapFit.leftTime, gapFit.rightTime], representativeMidpoint: gapFit.breakAt },
  searchExamples: { repetitions: searchExamples.length, observedMaximumGain: searchGain,
    maximumGainAtFirstCut: nullFit.rss - profile[0].rss, resampledMaximumGains: searchExamples },
  conditionalRirChecks,
  deterministicEffortEditSensitivity: { supportSessions: refSupport(plusOne(fixture.prior)).length,
    coupledReference: reference(plusOne(fixture.prior)), observationOnlyResiduals: observations(plusOne(fixture.scenarios.stable), m).map(row => row.value) },
  rolling,
  jointCandidate: { knownStrength: 100, knownCorrectProbability: correctProbability, knownLoadSd: 0.2, independentToyObservations: jointPoints.length,
    conditioning: 'recorded effort is fixed; no latent-RIR prior factor', profiles: jointProfiles, weakRepeatedProfile: weakJointProfile,
    exactIntegerRirMismatchFor80And81Kg: exactMismatch },
  limits: 'Method assertions, one joint recovery toy and 32 illustrative resamples only; no measured false-positive/power/coverage reliability or calibrated RIR errors.' },
  (_key, value) => value === -Infinity ? '-Infinity' : value, 2));
