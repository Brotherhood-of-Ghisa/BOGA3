// Paired research simulations; no runtime consumer or production inference.
import assert from 'node:assert/strict';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { jointLikelihoodGrid, jointLogLikelihood, recordedRirFromLatent, seededRandom,
  type JointRirPoint } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { profileContains, profileSet, upperQuantile, type ProfileResult } from '../../../apps/mobile/__tests__/helpers/curve-inference-research.ts';

const quick = process.argv.includes('--quick');
assert.ok(process.argv.slice(2).every(arg => arg === '--quick'));
const repetitions = quick ? 12 : 400, stressRepetitions = quick ? 12 : 200;
const strengths = Array.from({ length: 81 }, (_, i) => 80 + i * 0.5);
const sigmas = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
const fixedSigmas = [0, 0.5, 1, 2], counts = [12, 16, 24, 48];
const seedFor = (base: number, replication: number) => (base ^ Math.imul(replication + 1, 0x9e3779b1)) >>> 0;
type Scenario = { name: string; n: number; sigma: number; strength?: number; loadSd?: number;
  assumedLoadSd?: number; sets?: number; shared?: boolean; serial?: boolean; rounding?: boolean;
  reportingBias?: number; prior?: 'high' | 'phase'; highReps?: boolean; trend?: boolean };

function generate(scenario: Scenario, seed: number) {
  const random = seededRandom(seed), all: JointRirPoint[] = [], first: JointRirPoint[] = [];
  let serial = 0;
  for (let session = 0; session < scenario.n; session++) {
    serial = 0.8 * serial + 0.6 * random.normal();
    const commonError = scenario.shared ? random.normal() : 0;
    const fatigue = scenario.shared ? random.normal() : 0;
    for (let set = 0; set < (scenario.sets ?? 1); set++) {
      const m = scenario.highReps ? [8, 12, 15][session % 3] : [2, 4, 6][session % 3];
      const latent = scenario.prior === 'high' ? (random.uniform() < 0.8 ? 4 : 3)
        : scenario.prior === 'phase' ? [3, 2, 1, 4][session % 4] : Math.floor(random.uniform() * 5);
      const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, m + r)!);
      const strength = (scenario.strength ?? 100) + (scenario.trend ? 0.3 * session : 0);
      const predicted = strength / multipliers[latent];
      let load: number;
      let loadError = scenario.shared ? fatigue : random.normal();
      do {
        load = predicted + (scenario.loadSd ?? 1) * loadError;
        if (load < 0) loadError = random.normal();
      } while (load < 0);
      if (scenario.rounding) load = Math.round(load / 2.5) * 2.5;
      const draw = scenario.shared ? commonError : scenario.serial ? serial : random.normal();
      const n = recordedRirFromLatent(latent, scenario.sigma, draw + (scenario.reportingBias ?? 0));
      const point = { load, recordedRir: n, multipliers };
      all.push(point);
      if (set === 0) first.push(point); // Ordinal fixed before observations; never select by n or effective reps.
    }
  }
  return { first, all };
}

function fit(points: JointRirPoint[], loadSd: number, axis = strengths) {
  const grid = jointLikelihoodGrid(points, axis, sigmas, loadSd);
  return { grid, strengthProfile: axis.map((_, i) => Math.max(...grid.map(row => row[i]))),
    sigmaProfile: grid.map(row => Math.max(...row)) };
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const rate = (events: number, total: number) => ({ events, total, fraction: events / total,
  monteCarloSe: Math.sqrt(events / total * (1 - events / total) / total) });
const width = (p: ProfileResult | null, physicalLower?: number) => !p || p.components.some(c =>
  c.upper === null || (c.lower === null && physicalLower === undefined)) ? null :
  p.components.reduce((sum, c) => sum + c.upper! - (c.lower ?? physicalLower!), 0);

type Cutoffs = { fixed: Record<string, number>; strength: number; sigma: number };
const calibration: Record<number, Cutoffs> = {};
const calibrationEvidence: unknown[] = [];
for (const n of counts) {
  const jointStrength: number[] = [], jointSigma: number[] = [], fixed: Record<string, number> = {};
  for (const sigma of fixedSigmas) {
    const fixedScores: number[] = [], sScores: number[] = [], sdScores: number[] = [];
    const base = 11000000 + n * 10000 + sigma * 1000;
    for (let replication = 0; replication < repetitions; replication++) {
      const points = generate({ name: 'matched-calibration', n, sigma }, seedFor(base, replication)).first;
      const fitted = fit(points, 1), row = fitted.grid[sigmas.indexOf(sigma)];
      fixedScores.push(Math.max(0, 2 * (Math.max(...row) - jointLogLikelihood(points, 100, sigma, 1))));
      sScores.push(Math.max(0, 2 * (Math.max(...fitted.strengthProfile) - Math.max(...sigmas.map(sd => jointLogLikelihood(points, 100, sd, 1))))));
      sdScores.push(Math.max(0, 2 * (Math.max(...fitted.sigmaProfile) - Math.max(...row))));
    }
    fixed[String(sigma)] = upperQuantile(fixedScores, 0.95);
    jointStrength.push(upperQuantile(sScores, 0.95));
    jointSigma.push(upperQuantile(sdScores, 0.95));
    calibrationEvidence.push({ n, sigma, base, replications: repetitions, fixedScores, strengthScores: sScores, sigmaScores: sdScores });
  }
  calibration[n] = { fixed, strength: Math.max(...jointStrength), sigma: Math.max(...jointSigma) };
}

type Observation = { estimate: number | null; covered: boolean; intervalWidth: number | null;
  lowerBoundary: boolean; upperBoundary: boolean; unbounded: boolean; disconnected: boolean;
  sigmaEstimate?: number; sigmaCovered?: boolean; sigmaWidth?: number | null; sigmaUpperBoundary?: boolean;
  sigmaUnbounded?: boolean; sigmaDisconnected?: boolean };
function observation(p: ProfileResult | null, truth: number): Observation {
  return { estimate: p?.estimate ?? null, covered: profileContains(p, truth), intervalWidth: width(p),
    lowerBoundary: p?.lowerBoundary ?? false, upperBoundary: p?.upperBoundary ?? false,
    unbounded: p?.components.some(c => c.lower === null || c.upper === null) ?? false,
    disconnected: (p?.components.length ?? 0) > 1 };
}
function summarize(observations: Observation[], truth: number, sigma: number) {
  const errors = observations.flatMap(o => o.estimate === null ? [] : [o.estimate - truth]);
  const squared = errors.map(e => e * e), average = mean(errors), mse = mean(squared);
  const sigmaErrors = observations.flatMap(o => o.sigmaEstimate === undefined ? [] : [o.sigmaEstimate - sigma]);
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
    sigma: sigmaErrors.length ? { conditionalBias: mean(sigmaErrors), conditionalRmse: Math.sqrt(mean(sigmaErrors.map(e => e * e))!),
      unconditionalCoverage: rate(observations.filter(o => o.sigmaCovered).length, observations.length),
      upperBoundary: rate(observations.filter(o => o.sigmaUpperBoundary).length, observations.length),
      unboundedUpperInterval: rate(observations.filter(o => o.sigmaUnbounded).length, observations.length),
      disconnected: rate(observations.filter(o => o.sigmaDisconnected).length, observations.length),
      meanFiniteIntervalWidth: mean(observations.flatMap(o => o.sigmaWidth == null ? [] : [o.sigmaWidth])) } : null };
}

const scenarios: Scenario[] = counts.flatMap(n => fixedSigmas.map(sigma => ({ name: `matched-n${n}-sigma${sigma}`, n, sigma })));
scenarios.push(...[
  { name: 'off-grid-truth', strength: 100.35, sigma: 1.3 },
  { name: 'load-discrepancy-understated', loadSd: 3 }, { name: 'load-discrepancy-explicit', loadSd: 3, assumedLoadSd: 3 },
  { name: 'plate-rounded-2.5kg', rounding: true }, { name: 'high-latent-rir-prior', prior: 'high' as const },
  { name: 'wave-latent-rir-prior', prior: 'phase' as const }, { name: 'high-rep-range', highReps: true },
  { name: 'reporting-bias-plus-one', reportingBias: 1 }, { name: 'serial-reporting-error', serial: true },
  { name: 'changing-strength-in-constant-window', trend: true }, { name: 'three-sets-independent', sets: 3 },
  { name: 'three-sets-shared-error-fatigue', sets: 3, shared: true },
].map(s => ({ n: 24, sigma: 1, ...s })));

const experiments = scenarios.map((scenario, i) => {
  const base = 22000000 + i * 10000, matched = scenario.name.startsWith('matched');
  const total = matched ? repetitions : stressRepetitions;
  const selections = scenario.sets ? ['first', 'all'] as const : ['first'] as const;
  const output: Record<string, Record<string, Observation[]>> = {};
  let example: unknown;
  for (const selection of selections) output[selection] = Object.fromEntries([...fixedSigmas.map(s => `fixed-${s}`), 'joint'].map(m => [m, []]));
  for (let replication = 0; replication < total; replication++) {
    const data = generate(scenario, seedFor(base, replication));
    for (const selection of selections) {
      const fitted = fit(data[selection], scenario.assumedLoadSd ?? 1), cutoffs = calibration[scenario.n];
      for (const sd of fixedSigmas) output[selection][`fixed-${sd}`].push(observation(
        profileSet(strengths, fitted.grid[sigmas.indexOf(sd)], cutoffs.fixed[String(sd)]), scenario.strength ?? 100));
      const p = profileSet(strengths, fitted.strengthProfile, cutoffs.strength);
      const sp = profileSet(sigmas, fitted.sigmaProfile, cutoffs.sigma);
      output[selection].joint.push({ ...observation(p, scenario.strength ?? 100), sigmaEstimate: sp?.estimate,
        sigmaCovered: profileContains(sp, scenario.sigma), sigmaWidth: width(sp, 0), sigmaUpperBoundary: sp?.upperBoundary,
        sigmaUnbounded: sp?.components.some(c => c.upper === null), sigmaDisconnected: (sp?.components.length ?? 0) > 1 });
      if (replication === 0 && selection === 'first') example = { points: data.first, grid: fitted.grid,
        fixed: profileSet(strengths, fitted.grid[sigmas.indexOf(1)], cutoffs.fixed['1']), joint: p, sigmaProfile: sp,
        curve: Array.from({ length: 15 }, (_, r) => ({ reps: r + 1, truth: (scenario.strength ?? 100) / estimateOneRepMax(1, r + 1)!,
          fixed: output.first['fixed-1'][0].estimate! / estimateOneRepMax(1, r + 1)!, joint: p!.estimate / estimateOneRepMax(1, r + 1)! })) };
    }
  }
  return { scenario, base, replications: total,
    estimand: scenario.trend ? 'Initial S(t0)=100 only; changing window violates the constant-S estimand' : 'Constant latent S',
    methods: Object.fromEntries(Object.entries(output).map(([selection, methods]) =>
    [selection, Object.fromEntries(Object.entries(methods).map(([method, values]) => [method, summarize(values, scenario.strength ?? 100, scenario.sigma)]))])),
    replicateResults: output, example };
});

const sensitivityData = generate({ name: 'fine-grid', n: 24, sigma: 1 }, seedFor(33000000, 0)).first;
const coarse = fit(sensitivityData, 1), fineAxis = Array.from({ length: 161 }, (_, i) => 80 + i * 0.25);
const fine = fit(sensitivityData, 1, fineAxis), cuts = calibration[24];
const gridSensitivity = { coarse: profileSet(strengths, coarse.strengthProfile, cuts.strength),
  fine: profileSet(fineAxis, fine.strengthProfile, cuts.strength) };
assert.ok(Math.abs(gridSensitivity.coarse!.estimate - gridSensitivity.fine!.estimate) <= 0.5);
assert.ok(experiments.filter(e => e.scenario.name.startsWith('matched')).every(e =>
  e.methods.first.joint.validFits === e.replications));
const multipliers = Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, 6 + r)!);
const deterministicPoint = { load: 100 / multipliers[2], recordedRir: 2, multipliers };
const repeatedRecordDiagnostic = [1, 24, 72].map(copies => {
  const fitted = fit(Array.from({ length: copies }, () => deterministicPoint), 1);
  return { copies, strengthProfile: fitted.strengthProfile, sigmaProfile: fitted.sigmaProfile,
    limit: 'Exact copies of one deterministic m6/RIR2 observation; no known stochastic sigma, recovery/coverage or independent-session claims.' };
});
console.log(JSON.stringify({ design: { quick, repetitions, stressRepetitions, strengths, sigmas, fixedSigmas, counts,
  latentPrior: 'uniform integers 0-4', fittedLoadSd: 1, generator: 'nonnegative truncated normal; no RIR/u selection',
  interval: 'separate-seed model-specific fixed cutoffs; worst matched-sigma joint profile cutoff; interpolated grids',
  seedFor: 'base xor imul(replication+1, 0x9e3779b1)', nominalCoverage: 0.95 }, calibration, calibrationEvidence,
  experiments, gridSensitivity, repeatedRecordDiagnostic }, (_, value) => value === -Infinity ? '-Infinity' : value, 2));
