// Ephemeral research checks. Node 24 strips types; no production imports this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { calculateSetMetrics, type SetMetricInput } from '../../../apps/mobile/src/exercise-calculations/load-metrics.ts';
import { DEFAULT_PERSONAL_EFFORT_POLICY, getSessionSetRir } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { isWorkingSet } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { personalLoadContext } from '../../../apps/mobile/src/exercise-calculations/analytics.ts';
import { createAsOfWeightResolver } from '../../../apps/mobile/src/bodyweight/as-of.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

// Homogeneity in load yields the exact inverse, including the kernel's single.
const predictedLoad = (reference: number, reps: number): number | null => {
  const multiplier = estimateOneRepMax(1, reps);
  if (!Number.isFinite(reference) || reference < 0 || !Number.isSafeInteger(reps) || reps <= 0 || multiplier === null) return null;
  const load = reference / multiplier;
  return Number.isFinite(load) ? load : null;
};

const vectors = JSON.parse(readFileSync(new URL('../../../apps/mobile/src/exercise-calculations/load-metrics-vectors.json', import.meta.url), 'utf8')) as (SetMetricInput & { name: string })[];
let maxVectorError = 0;
for (const vector of vectors) {
  const metric = calculateSetMetrics(vector);
  assert.ok(metric.eligible && metric.load.status === 'known' && metric.estimatedTotalOneRepMaxKg !== null);
  const total = predictedLoad(metric.estimatedTotalOneRepMaxKg, metric.reps)!;
  const factor = vector.loadInputMode === 'per_side_load' ? 2 : 1;
  const entered = (total - metric.load.bodyweightPartKg) / factor;
  close(entered, metric.load.enteredWeightKg);
  maxVectorError = Math.max(maxVectorError, Math.abs(entered - metric.load.enteredWeightKg));
}
for (const reps of [1, 2, 8, 10, 30, 999]) {
  for (const reference of [0, 1, 100, 1e6]) {
    close(estimateOneRepMax(predictedLoad(reference, reps)!, reps)!, reference);
  }
}
for (const reps of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) assert.equal(predictedLoad(100, reps), null);
close(predictedLoad(100, 1000)!, 48.8);
for (const reference of [-1, NaN, Infinity]) assert.equal(predictedLoad(reference, 8), null);
assert.equal(predictedLoad(0, 8), 0);
assert.equal(predictedLoad(100, 1), 100);
const overflowing = calculateSetMetrics({ ...vectors[0], weightValue: `1${'0'.repeat(307)}`, repsValue: '8' });
assert.deepEqual(overflowing.load, { status: 'invalid', reason: 'numeric_overflow' });

const inverseTable = [1, 2, 5, 8, 10, 15, 20, 30, 50, 200, 999].map(reps => ({
  reps, unitMultiplier: estimateOneRepMax(1, reps), predictedKgFor100: predictedLoad(100, reps),
}));

// Labels are deliberately raw; eligibility and numerical RIR are separate.
const labels = ['rir_0', 'rir_1', 'rir_2', 'rir_3', 'rir_4', 'rir_7', null, 'unspecified', 'unknown', 'rir_01', 'warm_up', 'technique', 'cooldown'];
const efforts = labels.map(raw => ({ raw, rir: getSessionSetRir(raw), working: isWorkingSet({
  weight: '100', reps: '8', performanceStatus: null, setType: raw,
}, DEFAULT_PERSONAL_EFFORT_POLICY) }));
const strict = (maxRir: number) => efforts.filter(row => row.working && row.rir !== null && row.rir <= maxRir);
assert.deepEqual([strict(0).length, strict(1).length, strict(2).length], [1, 2, 3]);
assert.equal(efforts.filter(row => row.working).length, 10);
assert.equal(getSessionSetRir('rir_7'), 7);
assert.equal(getSessionSetRir('rir_01'), null);
for (const raw of labels) {
  close(calculateSetMetrics({ ...vectors[0], setType: raw }).estimatedOneRepMaxKg!,
    calculateSetMetrics(vectors[0]).estimatedOneRepMaxKg!);
}

// Separate analytical coordinate; actual metrics and logged effort stay intact.
const normalized = (input: SetMetricInput) => {
  const actual = calculateSetMetrics(input);
  const n = getSessionSetRir(input.setType);
  if (!actual.eligible || actual.load.status !== 'known' || n === null || !isWorkingSet({
    weight: input.weightValue ?? '', reps: input.repsValue ?? '', setType: input.setType,
    performanceStatus: input.performanceStatus,
  }, input.effortPolicy)) return null;
  const u = actual.reps + n;
  if (!Number.isSafeInteger(u) || u <= 0) return null;
  const analyticalRm = estimateOneRepMax(actual.load.calculatedLoadKg, u);
  if (analyticalRm === null || !Number.isFinite(analyticalRm)) return null;
  return { actual, n, u, analyticalRm };
};
for (const vector of vectors) {
  const result = normalized({ ...vector, setType: 'rir_2' })!;
  assert.ok(result.actual.eligible && result.actual.load.status === 'known');
  close(predictedLoad(result.analyticalRm, result.u)!, result.actual.load.calculatedLoadKg);
}
const example = { ...vectors[0], weightValue: '100', repsValue: '8', setType: 'rir_2' };
const rawSingle = normalized({ ...example, repsValue: '1' })!;
close(rawSingle.actual.estimatedOneRepMaxKg!, 100);
assert.equal(rawSingle.u, 3);
assert.ok(rawSingle.analyticalRm > 100);
close(normalized({ ...example, repsValue: '1', setType: 'rir_0' })!.analyticalRm, 100);
assert.equal(normalized({ ...example, setType: 'rir_7' })!.u, 15);
assert.equal(normalized({ ...example, repsValue: '999', setType: 'rir_1' })!.u, 1000);
assert.equal(normalized({ ...example, repsValue: '1', setType: `rir_${Number.MAX_SAFE_INTEGER}` }), null);
for (const setType of [null, 'unknown', 'rir_01', 'warm_up', 'technique']) assert.equal(normalized({ ...example, setType }), null);
assert.equal(normalized({ ...example, weightValue: '' })!.analyticalRm, 0);
assert.equal(normalized({ ...example, performanceStatus: 'planned' }), null);
assert.equal(normalized({ ...example, repsValue: '1000' }), null);
assert.equal(normalized({ ...example, repsValue: '1', weightValue: `1${'0'.repeat(307)}` }), null);
assert.equal(normalized({ ...example, effortPolicy: { workingSetEfforts: ['rir_0'], volumeEfforts: [] } }), null);
const sensitivity = [1, 2, 3].map(n => {
  const result = normalized({ ...example, setType: `rir_${n}` })!;
  return { n, u: result.u, actualRm: result.actual.estimatedOneRepMaxKg, analyticalRm: result.analyticalRm };
});
assert.ok(sensitivity[0].analyticalRm < sensitivity[1].analyticalRm && sensitivity[1].analyticalRm < sensitivity[2].analyticalRm);
assert.ok(sensitivity.every(row => row.actualRm === sensitivity[0].actualRm));
assert.deepEqual(sensitivity.map(row => row.u <= 10), [true, true, false]);
const phaseChecks = [[8, 2], [8, 3], [6, 2], [4, 2], [8, 4]].map(([m, n]) => {
  const result = normalized({ ...example, repsValue: String(m), setType: `rir_${n}`,
    weightValue: String(predictedLoad(100, m + n)) })!;
  close(result.analyticalRm, 100);
  return { m, n, u: result.u, analyticalRm: result.analyticalRm,
    actualRm: result.actual.estimatedOneRepMaxKg, referenceSupported: result.u <= 10 };
});
assert.deepEqual(phaseChecks.map(row => row.referenceSupported), [true, false, true, true, false]);

// Synthetic session-level estimates illustrate cutoff choices, not reliability.
const sessions = [100, 102, 104, 106, 108, 110, 115, 125, 140].map((rm, index) => {
  const result = normalized({ ...vectors[0], weightValue: String(predictedLoad(rm, 8)), repsValue: '8', setType: 'rir_0' })!;
  close(result.analyticalRm, rm);
  return { id: `s${index + 1}`, completedAt: index + 1, rm: result.analyticalRm };
});
const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const cutoff = 7;
const baseline = sessions.filter(row => row.completedAt < cutoff);
const fixed = median(baseline.map(row => row.rm));
close(fixed, 105);
const residual = (observed: number, predicted: number | null) => {
  if (predicted === null || !Number.isFinite(predicted) || predicted < 0 || !Number.isFinite(observed)) return { kg: null, percent: null };
  const kg = observed - predicted;
  if (!Number.isFinite(kg)) return { kg: null, percent: null };
  const percent = predicted > 0 ? 100 * (kg / predicted) : null;
  return { kg, percent: percent !== null && Number.isFinite(percent) ? percent : null };
};
assert.deepEqual(residual(0, 0), { kg: 0, percent: null });
assert.deepEqual(residual(1, null), { kg: null, percent: null });
for (const predicted of [-1, NaN, Infinity]) assert.deepEqual(residual(1, predicted), { kg: null, percent: null });
assert.deepEqual(residual(1, Number.MIN_VALUE), { kg: 1, percent: null });
assert.equal(residual(Number.MAX_VALUE, Number.MIN_VALUE).percent, null);
const comparisons = sessions.slice(6, 8).map(row => {
  const prior = sessions.filter(candidate => candidate.completedAt < row.completedAt);
  assert.ok(!prior.some(candidate => candidate.id === row.id || candidate.completedAt >= row.completedAt));
  const observed = predictedLoad(row.rm, 8)!;
  const references = {
    fixed, rollingThree: median(prior.slice(-3).map(candidate => candidate.rm)),
    allTimePrior: Math.max(...prior.map(candidate => candidate.rm)),
    currentIncludingEvaluation: Math.max(...sessions.slice(0, 8).map(candidate => candidate.rm)),
    futureLeaking: Math.max(...sessions.map(candidate => candidate.rm)),
  };
  return { id: row.id, observedKg: observed, references,
    residuals: Object.fromEntries(Object.entries(references).map(([name, rm]) => [name, residual(observed, predictedLoad(rm, 8))])) };
});
close(comparisons[0].residuals.fixed.percent!, 100 * (115 / 105 - 1));
close(comparisons[1].residuals.fixed.percent!, 100 * (125 / 105 - 1));
close(residual(predictedLoad(125, 8)!, predictedLoad(125, 8)).kg!, 0);
assert.ok(comparisons.every(row => residual(row.observedKg, predictedLoad(row.references.currentIncludingEvaluation, 8)).kg! <= 0));

const resolve = createAsOfWeightResolver([
  { id: 'old', measuredAt: 1, weightKg: 80 },
  { id: 'new', measuredAt: 10, weightKg: 90 },
  { id: 'malformed', measuredAt: 11, weightKg: NaN },
]);
const definition = { bodyweightContribution: 1, loadInputMode: 'total_load' as const };
const bodyweight = [0, 9, 10, 11].map(startedAt => {
  const dated = resolve(startedAt);
  const context = personalLoadContext(true, definition, dated, DEFAULT_PERSONAL_EFFORT_POLICY);
  const metric = calculateSetMetrics({ ...context, weightValue: '20', repsValue: '8', performanceStatus: null });
  assert.ok(metric.eligible && metric.load.status === 'known');
  const predictedTotal = predictedLoad(130, 8)!;
  return { startedAt, readingId: dated.bodyWeightMeasurementId, bodyWeightKg: dated.bodyWeightKg,
    observedTotalKg: metric.load.calculatedLoadKg, displayedRm: metric.estimatedOneRepMaxKg,
    enteredPredictionForFixedTotal130: predictedTotal - metric.load.bodyweightPartKg,
    residual: residual(metric.load.calculatedLoadKg, predictedTotal) };
});
assert.deepEqual(bodyweight.map(row => row.readingId), [null, 'old', 'new', 'new']);
assert.deepEqual(bodyweight.map(row => row.observedTotalKg), [20, 100, 110, 110]);
const family = [80, 90].map(bodyWeightKg => ({ bodyWeightKg,
  enteredPredictionForDisplayedRm30: predictedLoad(30 + bodyWeightKg, 8)! - bodyWeightKg }));
assert.notEqual(family[0].enteredPredictionForDisplayedRm30, family[1].enteredPredictionForDisplayedRm30);
const negative = predictedLoad(90, 30)! - 80;
assert.ok(negative < 0);
const scaleProof = residual(110, 100), perEntry = residual(55, 50);
close(scaleProof.percent!, perEntry.percent!);
close(scaleProof.kg!, 2 * perEntry.kg!);

console.log(JSON.stringify({ vectorCount: vectors.length, maxVectorError, inverseTable, efforts,
  sensitivity, phaseChecks, rawSingle: { actualRm: rawSingle.actual.estimatedOneRepMaxKg, u: rawSingle.u, analyticalRm: rawSingle.analyticalRm },
  baseline: baseline.map(row => row.id), comparisons, bodyweight, family,
  negativeEnteredPrediction: negative }, null, 2));
