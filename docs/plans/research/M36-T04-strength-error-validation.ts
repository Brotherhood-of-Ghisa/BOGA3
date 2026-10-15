// Paired research simulations; no runtime consumer or production inference.
import assert from 'node:assert/strict';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { jointLikelihoodGrid, jointLogLikelihood, latentRirFromRecorded, normalCdf, RIR_REPORTING_MODEL, seededRandom,
  type JointRirPoint } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { correctProbabilitySet, DEFAULT_ENTRY_LOAD_SD_KG, jointUncertaintyProfiles, profileContains, profileSet, rirCurveMultipliers, upperQuantile,
  type ProfileResult } from '../../../apps/mobile/__tests__/helpers/curve-inference-research.ts';

const quick = process.argv.includes('--quick');
assert.ok(process.argv.slice(2).every(arg => arg === '--quick'));
const repetitions = quick ? 12 : 400, stressRepetitions = quick ? 12 : 200;
const strengths = Array.from({ length: 81 }, (_, i) => 80 + i * 0.5);
const correctProbabilities = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1];
const fixedCorrectProbabilities = [0, 0.5, 0.75, 1], counts = [12, 16, 24, 48];
const fixedLoadSd = DEFAULT_ENTRY_LOAD_SD_KG.total_load, loadSds = [0.5, 1.25, 2.5, 3.75, 5, 7.5];
const seedFor = (base: number, replication: number) => (base ^ Math.imul(replication + 1, 0x9e3779b1)) >>> 0;
type Scenario = { name: string; n: number; correctProbability: number; strength?: number; loadSd?: number;
  assumedLoadSd?: number; sets?: number; shared?: boolean; serial?: boolean; rounding?: boolean;
  design?: 'high' | 'phase' | 'zero' | 'positive' | 'zero-to-positive' | 'one' | 'saturated';
  highReps?: boolean; trend?: boolean; asymmetric?: boolean; wideError?: boolean; falseZero?: boolean };

function generate(scenario: Scenario, seed: number) {
  const random = seededRandom(seed), all: JointRirPoint[] = [], first: JointRirPoint[] = [];
  let serial = random.normal();
  for (let session = 0; session < scenario.n; session++) {
    serial = 0.8 * serial + 0.6 * random.normal();
    const commonError = scenario.shared ? normalCdf(random.normal()) : 0;
    const fatigue = scenario.shared ? random.normal() : 0;
    for (let set = 0; set < (scenario.sets ?? 1); set++) {
      const m = scenario.highReps ? [8, 12, 15][session % 3] : [2, 4, 6][session % 3];
      let n = scenario.design === 'zero' ? 0 : scenario.design === 'one' ? 1 : scenario.design === 'saturated' ? 10000
        : scenario.design === 'positive' ? 1 + Math.floor(random.uniform() * 4)
        : scenario.design === 'zero-to-positive' ? (session < scenario.n / 2 ? 0 : 4)
        : scenario.design === 'high' ? (random.uniform() < 0.8 ? 4 : 3)
        : scenario.design === 'phase' ? [3, 2, 1, 4][session % 4] : Math.floor(random.uniform() * 5);
      if (scenario.wideError) n = 2 + session % 3;
      const draw = scenario.shared ? commonError : scenario.serial ? normalCdf(serial) : random.uniform();
      let latent = latentRirFromRecorded(n, scenario.correctProbability, draw);
      if (scenario.asymmetric && latent !== n) latent = n + 1;
      if (scenario.wideError && latent !== n) latent = n + (latent < n ? -2 : 2);
      if (scenario.falseZero && n > 0 && latent > 0 && random.uniform() < 0.2) n = 0;
      const multipliers = rirCurveMultipliers(m, n);
      const strength = (scenario.strength ?? 100) + (scenario.trend ? 0.3 * session : 0);
      const predicted = strength / estimateOneRepMax(1, m + latent)!;
      let load: number, loadError = scenario.shared ? fatigue : random.normal();
      do {
        load = predicted + (scenario.loadSd ?? fixedLoadSd) * loadError;
        if (load < 0) loadError = random.normal();
      } while (load < 0);
      if (scenario.rounding) load = Math.round(load / 2.5) * 2.5;
      const point = { load, recordedRir: n, multipliers };
      all.push(point);
      if (set === 0) first.push(point); // Ordinal fixed before observations; no residual/effort selection.
    }
  }
  return { first, all };
}

function fit(points: JointRirPoint[], loadSd = fixedLoadSd, axis = strengths) {
  const joint = jointUncertaintyProfiles(points, axis, correctProbabilities, loadSds);
  const grid = loadSds.includes(loadSd) ? joint.cube[loadSds.indexOf(loadSd)] : jointLikelihoodGrid(points, axis, correctProbabilities, loadSd);
  return { ...joint, grid };
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const rate = (events: number, total: number) => ({ events, total, fraction: events / total,
  monteCarloSe: Math.sqrt(events / total * (1 - events / total) / total) });
const width = (p: ProfileResult | null, physicalLower?: number) => !p || p.components.some(c =>
  c.upper === null || (c.lower === null && physicalLower === undefined)) ? null :
  p.components.reduce((sum, c) => sum + c.upper! - (c.lower ?? physicalLower!), 0);

type Cutoffs = { fixed: Record<string, number>; strength: number; correctProbability: number; load: number };
const calibration: Record<number, Cutoffs> = {};
const calibrationEvidence: unknown[] = [];
for (const n of counts) {
  const jointStrength: number[] = [], jointCorrect: number[] = [], jointLoad: number[] = [], fixed: Record<string, number> = {};
  for (const correctProbability of fixedCorrectProbabilities) {
    const fixedScores: number[] = [], sScores: number[] = [], correctScores: number[] = [], loadScores: number[] = [];
    const base = 91000000 + n * 10000 + correctProbability * 1000;
    for (let replication = 0; replication < repetitions; replication++) {
      const points = generate({ name: 'matched-calibration', n, correctProbability }, seedFor(base, replication)).first;
      const fitted = fit(points), row = fitted.grid[correctProbabilities.indexOf(correctProbability)], maximum = Math.max(...fitted.strengthProfile);
      fixedScores.push(Math.max(0, 2 * (Math.max(...row) - jointLogLikelihood(points, 100, correctProbability, fixedLoadSd))));
      const atTrueS = jointUncertaintyProfiles(points, [100], correctProbabilities, loadSds).strengthProfile[0];
      sScores.push(Math.max(0, 2 * (maximum - atTrueS)));
      correctScores.push(Math.max(0, 2 * (maximum - fitted.correctProfile[correctProbabilities.indexOf(correctProbability)])));
      loadScores.push(Math.max(0, 2 * (maximum - fitted.loadProfile[loadSds.indexOf(fixedLoadSd)])));
    }
    fixed[String(correctProbability)] = upperQuantile(fixedScores, 0.95);
    jointStrength.push(upperQuantile(sScores, 0.95));
    jointCorrect.push(upperQuantile(correctScores, 0.95));
    jointLoad.push(upperQuantile(loadScores, 0.95));
    calibrationEvidence.push({ n, correctProbability, loadSd: fixedLoadSd, base, replications: repetitions, fixedScores,
      strengthScores: sScores, correctScores: correctScores, loadScores });
  }
  calibration[n] = { fixed, strength: Math.max(...jointStrength), correctProbability: Math.max(...jointCorrect), load: Math.max(...jointLoad) };
}

type Observation = { estimate: number | null; covered: boolean; intervalWidth: number | null;
  lowerBoundary: boolean; upperBoundary: boolean; unbounded: boolean; disconnected: boolean;
  correctUnidentified?: boolean; correctEstimate?: number; correctCovered?: boolean; correctWidth?: number | null; correctUpperBoundary?: boolean; correctLowerBoundary?: boolean;
  correctUnbounded?: boolean; correctDisconnected?: boolean;
  loadEstimate?: number; loadCovered?: boolean; loadWidth?: number | null; loadBoundary?: boolean;
  loadUnbounded?: boolean; loadDisconnected?: boolean };
function observation(p: ProfileResult | null, truth: number): Observation {
  return { estimate: p?.estimate ?? null, covered: profileContains(p, truth), intervalWidth: width(p),
    lowerBoundary: p?.lowerBoundary ?? false, upperBoundary: p?.upperBoundary ?? false,
    unbounded: p?.components.some(c => c.lower === null || c.upper === null) ?? false,
    disconnected: (p?.components.length ?? 0) > 1 };
}
function summarize(observations: Observation[], truth: number, correctProbability: number, loadSd: number) {
  const errors = observations.flatMap(o => o.estimate === null ? [] : [o.estimate - truth]);
  const squared = errors.map(e => e * e), average = mean(errors), mse = mean(squared);
  const correctErrors = observations.flatMap(o => o.correctEstimate === undefined ? [] : [o.correctEstimate - correctProbability]);
  const loadErrors = observations.flatMap(o => o.loadEstimate === undefined ? [] : [o.loadEstimate - loadSd]);
  return { validFits: errors.length, failures: rate(observations.length - errors.length, observations.length),
    conditionalBias: average, biasMonteCarloSe: errors.length > 1 ? Math.sqrt(errors.reduce((s, e) => s + (e - average!) ** 2, 0) / (errors.length * (errors.length - 1))) : null,
    conditionalRmse: mse === null ? null : Math.sqrt(mse),
    rmseMonteCarloSe: squared.length > 1 && mse! > 0 ? Math.sqrt(squared.reduce((s, e) => s + (e - mse!) ** 2, 0)
      / (squared.length * (squared.length - 1))) / (2 * Math.sqrt(mse!)) : null,
    unconditionalCoverage: rate(observations.filter(o => o.covered).length, observations.length),
    meanFiniteIntervalWidth: mean(observations.flatMap(o => o.intervalWidth === null ? [] : [o.intervalWidth])),
    unbounded: rate(observations.filter(o => o.unbounded).length, observations.length),
    gridBoundary: rate(observations.filter(o => o.lowerBoundary || o.upperBoundary).length, observations.length),
    disconnected: rate(observations.filter(o => o.disconnected).length, observations.length),
    correctUnidentified: rate(observations.filter(o => o.correctUnidentified).length, observations.length),
    correctProbability: correctErrors.length ? { conditionalBias: mean(correctErrors), conditionalRmse: Math.sqrt(mean(correctErrors.map(e => e * e))!),
      unconditionalCoverage: rate(observations.filter(o => o.correctCovered).length, observations.length),
      lowerBoundary: rate(observations.filter(o => o.correctLowerBoundary).length, observations.length),
      upperBoundary: rate(observations.filter(o => o.correctUpperBoundary).length, observations.length),
      unboundedUpperInterval: rate(observations.filter(o => o.correctUnbounded).length, observations.length),
      disconnected: rate(observations.filter(o => o.correctDisconnected).length, observations.length),
      meanFiniteIntervalWidth: mean(observations.flatMap(o => o.correctWidth == null ? [] : [o.correctWidth])) } : null,
    load: loadErrors.length ? { conditionalBias: mean(loadErrors), conditionalRmse: Math.sqrt(mean(loadErrors.map(e => e * e))!),
      unconditionalCoverage: rate(observations.filter(o => o.loadCovered).length, observations.length),
      gridBoundary: rate(observations.filter(o => o.loadBoundary).length, observations.length),
      unbounded: rate(observations.filter(o => o.loadUnbounded).length, observations.length),
      disconnected: rate(observations.filter(o => o.loadDisconnected).length, observations.length),
      meanFiniteIntervalWidth: mean(observations.flatMap(o => o.loadWidth == null ? [] : [o.loadWidth])) } : null };
}

const scenarios: Scenario[] = counts.flatMap(n => fixedCorrectProbabilities.map(correctProbability => ({ name: `matched-n${n}-p${correctProbability}`, n, correctProbability })));
scenarios.push(...[
  { name: 'off-grid-truth', strength: 100.35, correctProbability: 0.65, loadSd: 3.1 },
  { name: 'load-discrepancy-understated', loadSd: 5 }, { name: 'load-discrepancy-explicit', loadSd: 5, assumedLoadSd: 5 },
  { name: 'plate-rounded-2.5kg', rounding: true }, { name: 'high-recorded-rir-design', design: 'high' as const },
  { name: 'wave-recorded-rir-design', design: 'phase' as const }, { name: 'high-rep-range', highReps: true },
  { name: 'asymmetric-errors', asymmetric: true }, { name: 'serial-categorical-error', serial: true },
  { name: 'changing-strength-in-constant-window', trend: true }, { name: 'three-sets-independent', sets: 3 },
  { name: 'three-sets-shared-error-fatigue', sets: 3, shared: true },
  { name: 'all-zero-rir-conditional', design: 'zero' as const },
  { name: 'all-positive-rir-conditional', design: 'positive' as const },
  { name: 'zero-to-positive-rir-composition', design: 'zero-to-positive' as const },
  { name: 'errors-beyond-one-rep', wideError: true }, { name: 'false-zero-readings-assumption-violation', falseZero: true },
  { name: 'logged-one-includes-actual-zero', design: 'one' as const },
  { name: 'saturated-high-rir', design: 'saturated' as const },
].map(s => ({ n: 24, correctProbability: 0.5, ...s })));

const experiments = scenarios.map((scenario, i) => {
  const base = 92000000 + i * 10000, matched = scenario.name.startsWith('matched');
  const total = matched ? repetitions : stressRepetitions;
  const selections = scenario.sets ? ['first', 'all'] as const : ['first'] as const;
  const output: Record<string, Record<string, Observation[]>> = {};
  let example: unknown;
  for (const selection of selections) output[selection] = Object.fromEntries([...fixedCorrectProbabilities.map(s => `fixed-${s}`), 'joint'].map(m => [m, []]));
  for (let replication = 0; replication < total; replication++) {
    const data = generate(scenario, seedFor(base, replication));
    for (const selection of selections) {
      const fitted = fit(data[selection], scenario.assumedLoadSd ?? fixedLoadSd), cutoffs = calibration[scenario.n];
      for (const probability of fixedCorrectProbabilities) output[selection][`fixed-${probability}`].push(observation(
        profileSet(strengths, fitted.grid[correctProbabilities.indexOf(probability)], cutoffs.fixed[String(probability)]), scenario.strength ?? 100));
      const p = profileSet(strengths, fitted.strengthProfile, cutoffs.strength);
      const sp = correctProbabilitySet(correctProbabilities, fitted.correctProfile, cutoffs.correctProbability);
      const lp = profileSet(loadSds, fitted.loadProfile, cutoffs.load);
      output[selection].joint.push({ ...observation(p, scenario.strength ?? 100), correctUnidentified: sp === null, correctEstimate: sp?.estimate,
        correctCovered: profileContains(sp, scenario.correctProbability), correctWidth: width(sp, 0), correctUpperBoundary: sp?.upperBoundary, correctLowerBoundary: sp?.lowerBoundary,
        correctUnbounded: sp?.components.some(c => c.upper === null), correctDisconnected: (sp?.components.length ?? 0) > 1,
        loadEstimate: lp?.estimate, loadCovered: profileContains(lp, scenario.loadSd ?? fixedLoadSd), loadWidth: width(lp),
        loadBoundary: lp?.lowerBoundary || lp?.upperBoundary, loadUnbounded: lp?.components.some(c => c.lower === null || c.upper === null),
        loadDisconnected: (lp?.components.length ?? 0) > 1 });
      if (replication === 0 && selection === 'first') example = { points: data.first, cube: fitted.cube, grid: fitted.grid,
        positiveRirObservations: fitted.positiveRirObservations, strengthProfile: fitted.strengthProfile, correctScores: fitted.correctProfile, loadScores: fitted.loadProfile,
        fixed: profileSet(strengths, fitted.grid[correctProbabilities.indexOf(0.5)], cutoffs.fixed['0.5']), joint: p, correctProfile: sp, loadProfile: lp,
        curve: Array.from({ length: 15 }, (_, r) => ({ reps: r + 1, truth: (scenario.strength ?? 100) / estimateOneRepMax(1, r + 1)!,
          fixed: output.first['fixed-0.5'][0].estimate! / estimateOneRepMax(1, r + 1)!, joint: p!.estimate / estimateOneRepMax(1, r + 1)! })) };
    }
  }
  return { scenario, base, replications: total,
    estimand: scenario.trend ? 'Initial S(t0)=100 only; changing window violates the constant-S estimand' : 'Constant latent S',
    methods: Object.fromEntries(Object.entries(output).map(([selection, methods]) =>
    [selection, Object.fromEntries(Object.entries(methods).map(([method, values]) => [method,
      summarize(values, scenario.strength ?? 100, scenario.correctProbability, scenario.loadSd ?? fixedLoadSd)]))])),
    replicateResults: output, example };
});

const sensitivityData = generate({ name: 'fine-grid', n: 24, correctProbability: 0.5 }, seedFor(93000000, 0)).first;
const coarse = fit(sensitivityData), fineAxis = Array.from({ length: 161 }, (_, i) => 80 + i * 0.25);
const fine = fit(sensitivityData, fixedLoadSd, fineAxis), cuts = calibration[24];
const gridSensitivity = { coarse: profileSet(strengths, coarse.strengthProfile, cuts.strength),
  fine: profileSet(fineAxis, fine.strengthProfile, cuts.strength) };
assert.ok(Math.abs(gridSensitivity.coarse!.estimate - gridSensitivity.fine!.estimate) <= 0.5);
assert.ok(experiments.filter(e => e.scenario.name.startsWith('matched')).every(e =>
  e.methods.first.joint.validFits === e.replications));
const allZero = experiments.find(e => e.scenario.name === 'all-zero-rir-conditional')!.methods.first.joint;
assert.equal(allZero.correctProbability, null);
assert.equal(allZero.correctUnidentified.fraction, 1);
const saturated = experiments.find(e => e.scenario.name === 'saturated-high-rir')!.methods.first.joint;
assert.equal(saturated.correctProbability, null);
assert.equal(saturated.correctUnidentified.fraction, 1);
const multipliers = rirCurveMultipliers(6, 2);
const deterministicPoint = { load: 100 / multipliers[1], recordedRir: 2, multipliers };
const repeatedRecordDiagnostic = [1, 24, 72].map(copies => {
  const fitted = fit(Array.from({ length: copies }, () => deterministicPoint));
  return { copies, strengthProfile: fitted.strengthProfile, correctProfile: fitted.correctProfile, loadProfile: fitted.loadProfile,
    limit: 'Exact copies of one deterministic m6/RIR2 observation; no known stochastic accuracy, recovery/coverage or independent-session claims.' };
});
console.log(JSON.stringify({ design: { quick, repetitions, stressRepetitions, strengths, correctProbabilities, loadSds, fixedCorrectProbabilities, counts,
  rirReportingModel: RIR_REPORTING_MODEL,
  conditionalModel: 'r|logged n: exact0 at n0; otherwise lower/central/upper with weights (1-p)/2,p,(1-p)/2; no latent prior factor',
  recordedRirDesign: 'uniform logged integers0-4 in matched cells; conditional likelihood does not model their frequency', fixedLoadSd, enteredLoadSds: DEFAULT_ENTRY_LOAD_SD_KG,
  generator: 'nonnegative truncated normal; no RIR/u selection; load-granularity discrepancy, logged weights exact',
  interval: 'separate-seed fixed cutoffs; worst matched-correct-probability joint cutoffs conditional on true total-load SD2.5kg; interpolated grids',
  seedFor: 'base xor imul(replication+1, 0x9e3779b1)', nominalCoverage: 0.95 }, calibration, calibrationEvidence,
  experiments, gridSensitivity, repeatedRecordDiagnostic }, (_, value) => value === -Infinity ? '-Infinity' : value, 2));
