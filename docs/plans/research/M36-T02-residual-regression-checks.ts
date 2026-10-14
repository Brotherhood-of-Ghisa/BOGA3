// Ephemeral numerical method checks; no production detector or reliability claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { calculateSetMetrics } from '../../../apps/mobile/src/exercise-calculations/load-metrics.ts';
import { getSessionSetRir } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { isWorkingSet } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { fitRegression, jointLogLikelihood, median, normalCdf, predict, recordedRirFromLatent,
  recordedRirLogProbability, recordedRirProbability, researchBic, scanBreaks, seededRandom, sessionMedians,
  type JointRirPoint, type ResearchRow } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';

type WaveSet = {
  session: string; phase: string; week: number; set: number; startedAt: number; completedAt: number;
  reps: number; rir: number; weightValue: string; repsValue: string; setType: string;
  performanceStatus: null; gym: string; loadInputMode: 'total_load'; bodyweightContribution: number;
};
const source = readFileSync(new URL('../../../apps/mobile/__tests__/fixtures/rm-curve-weekly-wave.json', import.meta.url), 'utf8');
const fixture = JSON.parse(source) as { prior: WaveSet[]; scenarios: Record<string, WaveSet[]> };
const seed = 20261013;
const sdArgument = process.argv.slice(2);
assert.ok(sdArgument.length <= 1 && sdArgument.every(arg => /^--rir-sd=\d+(\.\d+)?$/.test(arg)), 'use --rir-sd=<nonnegative SD in reps>');
const rirSd = sdArgument.length ? Number(sdArgument[0].split('=')[1]) : 1;
assert.ok(Number.isFinite(rirSd) && rirSd >= 0);
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

// Known latent inputs generate records forward; this does not recover actual latent RIR.
function forward(rows: WaveSet[], sd: number, simulationSeed: number): WaveSet[] {
  const rng = seededRandom(simulationSeed);
  return rows.map(row => {
    const recorded = recordedRirFromLatent(row.rir, sd, rng.normal());
    return { ...row, rir: recorded, setType: `rir_${recorded}` };
  });
}
assert.deepEqual(forward(fixture.prior, 0, seed), fixture.prior);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const rirBoundary = [...new Set([0, 0.5, 1, 2, rirSd])].flatMap(sd => [0, 1, 2, 4].map(latent => {
  const rng = seededRandom(seed);
  const recorded = Array.from({ length: 32 }, () => recordedRirFromLatent(latent, sd, rng.normal()));
  assert.ok(recorded.every(n => Number.isSafeInteger(n) && n >= 0));
  return { sd, latent, meanRecorded: mean(recorded), minimum: Math.min(...recorded), maximum: Math.max(...recorded) };
}));
assert.equal(recordedRirFromLatent(0, 1, -2), 0);
assert.equal(recordedRirFromLatent(4, 1, 3), 7, 'no high-RIR clamp');
const noisyPrior = forward(fixture.prior, rirSd, seed + 2);
const noisyStable = forward(fixture.scenarios.stable, rirSd, seed + 3);
const coupledReference = reference(noisyPrior);
const observationOnly = observations(noisyStable, m), coupled = observations(noisyStable, coupledReference);
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

// A separate joint-window candidate retains an explicit load/task discrepancy scale.
close(normalCdf(0), 0.5);
assert.ok(Math.abs(normalCdf(1) - 0.8413447460685429) < 1e-9);
assert.ok(recordedRirProbability(0, 0, 1) > recordedRirProbability(1, 0, 1));
close(Array.from({ length: 20 }, (_, n) => recordedRirProbability(n, 2, 1)).reduce((sum, p) => sum + p, 0), 1);
const tailMultipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
const tailPoint = { load: 100 / tailMultipliers[4], recordedRir: 7, multipliers: tailMultipliers };
const highRirProbability = recordedRirProbability(7, 4, 0.25);
assert.ok(Math.abs(highRirProbability / 7.619853024160593e-24 - 1) < 1e-10);
assert.ok(Number.isFinite(jointLogLikelihood([tailPoint], 100, 0.25, 0.2)));
assert.equal(jointLogLikelihood([tailPoint], 100, 0, 0.2), -Infinity);
assert.equal(recordedRirProbability(100, 4, 0.25), 0);
assert.ok(Number.isFinite(recordedRirLogProbability(100, 4, 0.25)));
assert.ok(Number.isFinite(jointLogLikelihood([{ ...tailPoint, recordedRir: 100 }], 100, 0.25, 0.2)));
const jointRandom = seededRandom(seed + 4);
const jointPoints: JointRirPoint[] = Array.from({ length: 32 }, (_, index) => {
  const performed = [2, 4, 6][index % 3], latent = Math.floor(jointRandom.uniform() * 5);
  const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, performed + r)!);
  const recordedRir = recordedRirFromLatent(latent, 1, jointRandom.normal());
  return { multipliers, recordedRir, load: 100 / multipliers[latent] + 0.2 * jointRandom.normal() };
});
const strengthGrid = Array.from({ length: 41 }, (_, index) => 90 + 0.5 * index);
const sdGrid = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
function jointProfile(points: JointRirPoint[], loadSd: number) {
  const candidates = strengthGrid.flatMap(strength => sdGrid.map(sd => ({ strength, sd,
    logLikelihood: jointLogLikelihood(points, strength, sd, loadSd) }))).sort((a, b) => b.logLikelihood - a.logLikelihood);
  const maximum = candidates[0];
  const near = candidates.filter(row => row.logLikelihood >= maximum.logLikelihood - 2);
  return { loadSd, maximum, fixedSdOne: candidates.find(row => row.sd === 1),
    descriptiveWithinTwoLogUnits: { count: near.length, strengthRange: [Math.min(...near.map(row => row.strength)), Math.max(...near.map(row => row.strength))],
      sdRange: [Math.min(...near.map(row => row.sd)), Math.max(...near.map(row => row.sd))] },
    profileSd: sdGrid.map(sd => candidates.find(row => row.sd === sd)) };
}
const jointProfiles = [0.2, 1, 3].map(loadSd => jointProfile(jointPoints, loadSd));
assert.ok(Math.abs(jointProfiles[0].maximum.strength - 100) <= 1);
assert.ok(jointProfiles[0].maximum.sd >= 0.5 && jointProfiles[0].maximum.sd <= 1.5);
const repeated = Array.from({ length: 8 }, () => ({ load: 80, recordedRir: 2,
  multipliers: Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!) }));
const weakJointProfile = jointProfile(repeated, 3);
const exactMismatch = Math.min(...repeated[0].multipliers.flatMap(a => repeated[0].multipliers.map(b => Math.abs(80 * a - 81 * b))));
assert.ok(exactMismatch > 1e-6, 'two nearby loads need not share an exact common integer-RIR strength');

console.log(JSON.stringify({ seed, rirSd, fixtureSha256: createHash('sha256').update(source).digest('hex'),
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
  rirBoundary, forwardRir: { originalReferenceSupport: refSupport(fixture.prior),
    perturbedReferenceSupport: refSupport(noisyPrior), coupledReference,
    observationOnlyResiduals: observationOnly.map(row => row.value), coupledResiduals: coupled.map(row => row.value),
    deterministicPlusOne: { supportSessions: refSupport(plusOne(fixture.prior)).length,
      coupledReference: reference(plusOne(fixture.prior)), observationOnlyResiduals: observations(plusOne(fixture.scenarios.stable), m).map(row => row.value) } },
  rolling, highRirTail: { highRirProbability, highRirLogProbability: recordedRirLogProbability(7, 4, 0.25),
    finiteJointScore: jointLogLikelihood([tailPoint], 100, 0.25, 0.2),
    underflowSafeLogProbability: recordedRirLogProbability(100, 4, 0.25) },
  jointCandidate: { knownStrength: 100, knownRirSd: 1, knownLoadSd: 0.2, independentToyObservations: jointPoints.length,
    latentRirPrior: 'uniform integers 0..4 in this toy only', profiles: jointProfiles, weakRepeatedProfile: weakJointProfile,
    exactIntegerRirMismatchFor80And81Kg: exactMismatch },
  limits: 'Method assertions, one joint recovery toy and 32 illustrative resamples only; no measured false-positive/power/coverage reliability or calibrated RIR errors.' },
  (_key, value) => value === -Infinity ? '-Infinity' : value, 2));
