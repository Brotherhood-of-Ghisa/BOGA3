// Session-aware synthetic research; a detected analytical-RM shift is not proof of latent strength change.
import assert from 'node:assert/strict';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { fitRegression, predict, scanBreaks, seededRandom, sessionMedians,
  recordedRirFromLatent, RIR_REPORTING_MODEL, type ResearchRow } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { DEFAULT_ENTRY_LOAD_SD_KG, prefixBreakMaximum, searchedBreak, upperQuantile } from '../../../apps/mobile/__tests__/helpers/curve-inference-research.ts';

const quick = process.argv.includes('--quick');
assert.ok(process.argv.slice(2).every(arg => arg === '--quick'));
const repetitions = quick ? 12 : 400, stressRepetitions = quick ? 12 : 200;
const prefixes = [12, 16, 24, 48], seedFor = (base: number, r: number) => (base ^ Math.imul(r + 1, 0x9e3779b1)) >>> 0;
const loadSd = DEFAULT_ENTRY_LOAD_SD_KG.total_load;
type Scenario = { name: string; n: number; model: 'constant' | 'linear' | 'quadratic' | 'jump' | 'hinge';
  effect?: number; cut?: number; gap?: boolean; serial?: boolean; outlier?: boolean; heteroscedastic?: boolean;
  reportedRirMix?: boolean; rirComposition?: boolean; falseZero?: boolean; dependence?: boolean; minimum?: number };
const valueAt = (s: Scenario, t: number) => 100 + (s.model === 'constant' ? 0 : 0.2 * t) +
  (s.model === 'quadratic' ? 0.008 * t * t : s.model === 'jump' ? s.effect! * Number(t > s.cut!)
    : s.model === 'hinge' ? s.effect! * Math.max(0, t - s.cut!) : 0);

function generate(s: Scenario, seed: number) {
  const random = seededRandom(seed), all: { session: string; time: number; value: number }[] = [];
  let serial = 0;
  for (let i = 0; i < s.n; i++) {
    const time = i + (s.gap && i >= s.n / 2 ? 20 : 0);
    serial = 0.8 * serial + 0.6 * random.normal();
    const error = s.serial ? serial : random.normal();
    let value = valueAt(s, time) + loadSd * error * (s.heteroscedastic ? 1 + i / s.n * 2 : 1);
    if (s.outlier && i === Math.floor(s.n / 2)) value += 10;
    if (s.reportedRirMix || s.rirComposition || s.falseZero) {
      const m = s.reportedRirMix ? (i < s.n / 2 ? 4 : 12) : 6;
      const r = i < s.n / 2 ? 0 : 4;
      let n = recordedRirFromLatent(r, 1, random.normal());
      if (s.falseZero && r > 0 && i % 3 === 0) n = 0;
      const f = estimateOneRepMax(1, m + r)!;
      value = estimateOneRepMax(valueAt(s, time) / f + loadSd * error, m + n)!;
    } else {
      // A synthetic RIR0 single makes the regression target exactly noisy 1RM amplitude.
      assert.equal(estimateOneRepMax(value, 1), value);
    }
    for (let set = 0; set < (s.dependence ? 3 : 1); set++) all.push({ session: `s${i}`, time,
      value: value + (s.dependence ? 0.2 * random.normal() : 0) });
  }
  return { rows: sessionMedians(all), all: all.map(({ time, value }) => ({ time, value })) };
}
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const rate = (events: number, total: number) => ({ events, total, fraction: events / total,
  monteCarloSe: Math.sqrt(events / total * (1 - events / total) / total) });
const allowed = (n: number) => prefixes.filter(p => p <= n);
const noBreak = ['constant', 'linear', 'quadratic'] as const;

// One family threshold includes both forms, every cut, every declared prefix and all three null shapes.
const calibrationMaximums: number[] = [];
for (let r = 0; r < repetitions; r++) {
  calibrationMaximums.push(Math.max(...noBreak.map((model, i) => prefixBreakMaximum(
    generate({ name: model, n: 48, model }, seedFor(44000000 + i * 10000, r)).rows, prefixes)!)));
}
const cutoff = upperQuantile(calibrationMaximums, 0.95);

// Known-form, separate-seed diagnostic intervals; no post-selection guarantee.
const intervalCalibration: Record<string, { date: number; effect: number }> = {};
const intervalEvidence: unknown[] = [];
for (const n of [16, 24, 48]) for (const model of ['jump', 'hinge'] as const) {
  const errors = (model === 'jump' ? [2.5, 5, 10] : [0.25, 0.5, 1]).map((effect, j) => {
    const date: number[] = [], amplitude: number[] = [], base = 55000000 + n * 10000 + (model === 'jump' ? 0 : 1000) + j * 100;
    for (let r = 0; r < repetitions; r++) {
      const s = { name: model, n, model, effect, cut: n / 2 - 0.5 };
      const fits = scanBreaks(generate(s, seedFor(base, r)).rows, 8).filter(f => f.model === model).sort((a, b) => a.rss - b.rss);
      assert.ok(fits.length);
      date.push(Math.abs(fits[0].breakAt! - s.cut));
      amplitude.push(Math.abs(fits[0].coefficients[2] - effect));
    }
    intervalEvidence.push({ n, model, effect, base, dateErrors: date, effectErrors: amplitude });
    return { date: upperQuantile(date, 0.975), effect: upperQuantile(amplitude, 0.975) };
  });
  intervalCalibration[`${n}:${model}`] = { date: Math.max(...errors.map(e => e.date)), effect: Math.max(...errors.map(e => e.effect)) };
}

function predictionErrors(rows: ResearchRow[]) {
  const errors = { constant: [] as number[], linear: [] as number[], quadratic: [] as number[], searched: [] as number[] };
  for (let end = 16; end < rows.length; end++) {
    const prior = rows.slice(0, end);
    for (const model of noBreak) {
      const fit = fitRegression(prior, model);
      if (fit) errors[model].push((predict(fit, rows[end]) - rows[end].value) ** 2);
    }
    const scan = searchedBreak(prior);
    const fit = scan && scan.statistic > cutoff ? scan.fit : fitRegression(prior, 'quadratic');
    if (fit) errors.searched.push((predict(fit, rows[end]) - rows[end].value) ** 2);
  }
  return Object.fromEntries(Object.entries(errors).map(([model, e]) => [model, { forecasts: e.length, squaredErrors: e }]));
}

const scenarios: Scenario[] = prefixes.flatMap(n => noBreak.map(model => ({ name: `${model}-n${n}`, n, model })));
for (const n of [16, 24, 48]) for (const model of ['jump', 'hinge'] as const)
  for (const effect of model === 'jump' ? [2.5, 5, 10] : [0.25, 0.5, 1]) scenarios.push({
    name: `${model}-${effect}-n${n}`, n, model, effect, cut: n / 2 - 0.5 });
scenarios.push(
  { name: 'off-grid-jump', n: 24, model: 'jump', effect: 5, cut: 11.2 },
  { name: 'gap-jump', n: 24, model: 'jump', effect: 5, cut: 20 },
  { name: 'boundary-jump-outside-search', n: 24, model: 'jump', effect: 5, cut: 3.5 },
  ...['serial', 'outlier', 'heteroscedastic', 'reportedRirMix', 'dependence', 'rirComposition', 'falseZero'].map(key =>
    ({ name: `constant-${key}`, n: 24, model: 'constant' as const, [key]: true })),
  { name: 'jump-minimum-six', n: 24, model: 'jump', effect: 5, cut: 11.5, minimum: 6 },
  { name: 'jump-minimum-ten', n: 24, model: 'jump', effect: 5, cut: 11.5, minimum: 10 });
scenarios.find(s => s.name === 'gap-jump')!.gap = true;

const experiments = scenarios.map((s, index) => {
  const base = 66000000 + index * 10000;
  const total = index < 30 ? repetitions : stressRepetitions;
  const replicates = Array.from({ length: total }, (_, r) => {
    const { rows, all } = generate(s, seedFor(base, r)), minimum = s.minimum ?? 8;
    const maximum = prefixBreakMaximum(rows, allowed(s.n), minimum);
    const scan = searchedBreak(rows, minimum), detected = maximum !== null && maximum > cutoff;
    const known = s.model === 'jump' || s.model === 'hinge' ? scanBreaks(rows, minimum)
      .filter(f => f.model === s.model).sort((a, b) => a.rss - b.rss)[0] : undefined;
    const interval = intervalCalibration[`${s.n}:${s.model}`];
    const dateError = known ? Math.abs(known.breakAt! - s.cut!) : null;
    const effectError = known ? Math.abs(known.coefficients[2] - s.effect!) : null;
    const dateInterval = known && interval ? [known.leftTime - interval.date, known.rightTime + interval.date] : null;
    return { detected, maximum, selected: scan?.fit.model ?? null, fullPrefixStatistic: scan?.statistic ?? null,
      knownModelDateError: dateError, knownModelEffectError: effectError,
      knownModelDateCovered: !!dateInterval && s.cut! >= dateInterval[0] && s.cut! <= dateInterval[1],
      knownModelEffectCovered: !!interval && effectError !== null && effectError <= interval.effect,
      dateInterval, prediction: predictionErrors(rows),
      naiveSetDetected: s.dependence ? prefixBreakMaximum(all, allowed(s.n).map(n => n * 3), minimum * 3)! > cutoff : null };
  });
  const squaredErrors = (model: string) => replicates.flatMap(r => (r.prediction[model] as { squaredErrors: number[] }).squaredErrors);
  const fullFlags = replicates.filter(r => r.fullPrefixStatistic !== null && r.fullPrefixStatistic > cutoff);
  const hasBreak = s.model === 'jump' || s.model === 'hinge';
  return { scenario: s, base, replications: total, anyPrefixDetection: rate(replicates.filter(r => r.detected).length, total),
    noAdmissibleSearch: rate(replicates.filter(r => r.maximum === null).length, total),
    fullPrefixFlags: rate(fullFlags.length, total),
    fullPrefixCorrectFormDetection: hasBreak ? rate(fullFlags.filter(r => r.selected === s.model).length, total) : null,
    conditionalCorrectFormAccuracy: hasBreak && fullFlags.length ? rate(fullFlags.filter(r => r.selected === s.model).length, fullFlags.length) : null,
    meanKnownModelDateError: mean(replicates.flatMap(r => r.knownModelDateError === null ? [] : [r.knownModelDateError])),
    knownModelDateCoverage: hasBreak ? rate(replicates.filter(r => r.knownModelDateCovered).length, total) : null,
    knownModelEffectCoverage: hasBreak ? rate(replicates.filter(r => r.knownModelEffectCovered).length, total) : null,
    knownModelJointCoverage: hasBreak ? rate(replicates.filter(r => r.knownModelDateCovered && r.knownModelEffectCovered).length, total) : null,
    naiveSetDetection: s.dependence ? rate(replicates.filter(r => r.naiveSetDetected).length, total) : null,
    predictionRmse: Object.fromEntries([...noBreak, 'searched'].map(model => [model, { forecasts: squaredErrors(model).length,
      rmse: squaredErrors(model).length ? Math.sqrt(mean(squaredErrors(model))!) : null }])), replicates };
});

// Retrospective wild-bootstrap sensitivity: multiply a whole independent session (or four-session block), then redo the full search.
const bootstrapRepetitions = quick ? 19 : 199, bootstrapHistories = quick ? 4 : 80;
const bootstrap = [false, true].map(serial => {
  const histories = Array.from({ length: bootstrapHistories }, (_, replication) => {
    const seed = seedFor(77000000 + Number(serial) * 10000, replication);
    const rows = generate({ name: 'bootstrap-null', n: 24, model: 'linear', serial }, seed).rows;
    const smooth = fitRegression(rows, 'quadratic')!, observed = prefixBreakMaximum(rows, [12, 16, 24])!;
    return { seed, observed, methods: [1, 4].map(blockSize => {
      const random = seededRandom(seed ^ blockSize);
      const maxima = Array.from({ length: bootstrapRepetitions }, () => {
        const signs = Array.from({ length: Math.ceil(rows.length / blockSize) }, () => random.uniform() < 0.5 ? -1 : 1);
        return prefixBreakMaximum(rows.map((row, i) => ({ time: row.time,
          value: smooth.fitted[i] + smooth.residuals[i] * signs[Math.floor(i / blockSize)] })), [12, 16, 24])!;
      });
      const threshold = upperQuantile(maxima, 0.95);
      return { blockSize, threshold, rejected: observed > threshold, maxima };
    }) };
  });
  return { serial, histories, rates: [1, 4].map(blockSize => ({ blockSize,
    rejection: rate(histories.filter(h => h.methods.find(m => m.blockSize === blockSize)!.rejected).length, bootstrapHistories) })) };
});
assert.ok(experiments.filter(e => e.scenario.n === 12).every(e => e.noAdmissibleSearch.fraction === 1));
console.log(JSON.stringify({ design: { quick, repetitions, stressRepetitions, prefixes, minimumSegment: 8,
  rirReportingModel: RIR_REPORTING_MODEL,
  benchmarkTarget: 'S(t) via noisy RIR0 single; mixed-RIR/composition/false-zero stresses target observed A instead', independentErrorSd: loadSd,
  nullShapes: noBreak, nominalFamilyError: 0.05, interval: 'separate-seed known-form, worst effect-size 97.5% marginal error radii; not post-selection',
  seedFor: 'base xor imul(replication+1, 0x9e3779b1)' }, cutoff, calibrationMaximums, intervalCalibration,
  intervalEvidence, experiments, bootstrap: { bootstrapRepetitions, bootstrapHistories, results: bootstrap } }, null, 2));
