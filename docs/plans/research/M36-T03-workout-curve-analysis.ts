// Reproducible, read-only research. Outputs are diagnostics, never calibrated inference.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SYSTEM_EXERCISE_DEFINITION_SEEDS } from '../../../apps/mobile/src/data/exercise-catalog-seeds.ts';
import { validateBogaSessionImportPackage, type BogaSessionImportPackage } from '../../../apps/mobile/scripts/import/boga-import-contract.ts';
import { generatedExerciseDefinitionId, generatedSessionId, generatedSessionExerciseId, generatedSetId } from '../../../apps/mobile/scripts/import/boga-import-ids.ts';
import { createAsOfWeightResolver } from '../../../apps/mobile/src/bodyweight/as-of.ts';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { getSessionSetRir } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { curveResidual, curveScopeKey, priorCurveReference, projectCurveHistory,
  type CurveHistoryRow, type CurvePoint } from '../../../apps/mobile/__tests__/helpers/curve-history-research.ts';
import { fitRegression, median, predict, sessionMedians } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';

assert.equal(process.env.TZ, 'Europe/London', 'declare the research calendar: TZ=Europe/London');
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => arg.startsWith('--remote-input=') && arg.length > 15));
const loadJson = (url: URL | string) => {
  const bytes = readFileSync(url), value = JSON.parse(bytes.toString());
  return { value, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const waveSource = loadJson(new URL('../../../apps/mobile/__tests__/fixtures/rm-curve-weekly-wave.json', import.meta.url));
const importSource = loadJson(new URL('../../../apps/mobile/scripts/import/fixtures/dev-rich-history.boga-import.json', import.meta.url));
const pkg = importSource.value as BogaSessionImportPackage;
assert.deepEqual(validateBogaSessionImportPackage(pkg), { ok: true, errors: [] });

function importRows(): CurveHistoryRow[] {
  const definitions = new Map(SYSTEM_EXERCISE_DEFINITION_SEEDS.map(d => [d.id, d]));
  // Reconstruct the dev seeder's precedence, never infer loading from a name.
  for (const d of pkg.target.catalogSnapshot.exercises) if (!definitions.has(d.id))
    definitions.set(d.id, { ...d, loadInputMode: 'total_load', bodyweightContribution: 0 });
  const decisions = new Map(pkg.exerciseDecisions.map(d => [d.sourceExerciseName, d]));
  const resolve = createAsOfWeightResolver(pkg.bodyWeightMeasurements.map(r => ({
    id: r.id, measuredAt: Date.parse(r.measuredAt), weightKg: r.weightKg,
  })));
  return pkg.sessions.flatMap(s => s.exercises.flatMap(e => {
    const d = decisions.get(e.sourceExerciseName)!;
    assert.ok(d);
    const definition = d.decision === 'create_new' ? d : definitions.get(d.exerciseDefinitionId)!;
    assert.ok(definition);
    const exercise = d.decision === 'create_new' ? generatedExerciseDefinitionId(pkg, d) : d.exerciseDefinitionId;
    const session = generatedSessionId(pkg, s), block = generatedSessionExerciseId(session, e);
    return e.sets.map(set => ({ owner: 'rich-history-demo', exercise, gym: s.gymId,
      session, block, id: generatedSetId(block, set), blockOrder: e.orderIndex, setOrder: set.orderIndex, status: 'completed',
      startedAt: Date.parse(s.startedAt), completedAt: Date.parse(s.completedAt), deleted: false,
      weightValue: set.weightValue, repsValue: set.repsValue, setType: set.setType,
      performanceStatus: set.performanceStatus, loadInputMode: definition.loadInputMode,
      bodyweightContribution: definition.bodyweightContribution, bodyweightEnabled: pkg.bodyweightCalculationsEnabled,
      bodyWeightKg: resolve(Date.parse(s.startedAt)).bodyWeightKg }));
  }));
}
type WaveSet = { session: string; set: number; gym: string; week: number; phase: string } &
  Pick<CurveHistoryRow, 'startedAt' | 'completedAt' | 'weightValue' | 'repsValue' | 'setType' | 'performanceStatus' | 'loadInputMode' | 'bodyweightContribution'>;
const waveRows = (rows: WaveSet[], owner: string): CurveHistoryRow[] => rows.map(r => ({ ...r,
  owner, exercise: 'synthetic-zercher', gym: r.gym, id: `${r.session}:${r.set}`, block: r.session,
  status: 'completed', deleted: false, bodyweightEnabled: false, bodyWeightKg: null }));
const stats = (values: number[]) => values.length ? { count: values.length,
  mean: values.reduce((a, b) => a + b, 0) / values.length, median: median(values),
  minimum: Math.min(...values), maximum: Math.max(...values) } : null;
const count = (values: string[]) => values.reduce<Record<string, number>>((a, v) => { a[v] = (a[v] ?? 0) + 1; return a; }, {});
const filterEffort = (rows: CurveHistoryRow[], rir: number | null) => rir === null ? rows : rows.filter(r => getSessionSetRir(r.setType) === rir);
function perturb(rows: CurveHistoryRow[], delta: number) {
  return rows.map(r => { const n = getSessionSetRir(r.setType); return n === null ? r : { ...r, setType: `rir_${Math.max(0, n + delta)}` }; });
}
function diagnose(points: CurvePoint[], start: number, rm: number | null) {
  const evaluated = points.filter(p => p.row.startedAt >= start);
  const residuals = evaluated.flatMap(p => { const r = curveResidual(p, rm); return r ? [{ p, ...r }] : []; });
  const sessions = sessionMedians(residuals.map(r => ({ session: r.p.row.session,
    time: (r.p.row.startedAt - start) / 604800000, value: r.percentage })));
  const by = (key: (p: CurvePoint) => string) => Object.fromEntries([...new Set(evaluated.map(key))].map(k => {
    const subset = residuals.filter(r => key(r.p) === k);
    return [k, { sets: subset.length, sessions: new Set(subset.map(r => r.p.row.session)).size,
      percent: stats(subset.map(r => r.percentage)), signedKg: stats(subset.map(r => r.signedKg)) }];
  }));
  return { evaluatedSets: evaluated.length, evaluatedSessions: new Set(evaluated.map(p => p.row.session)).size,
    percent: stats(residuals.map(r => r.percentage)), signedKg: stats(residuals.map(r => r.signedKg)),
    sessionMedianPercent: stats(sessions.map(s => s.value)), byRir: by(p => String(p.rir)),
    byActualRepRange: by(p => p.reps <= 5 ? '1-5' : p.reps <= 10 ? '6-10' : '11+'),
    byEquivalentSupport: by(p => p.equivalentReps <= 10 ? '1-10' : '11+'),
    linearFit: fitRegression(sessions, 'linear'), sessionResponses: sessions,
    plotPoints: evaluated.map(p => ({ equivalentReps: p.equivalentReps, load: p.load / p.factor,
      analyticalRm: p.analyticalRm, factor: p.factor })) };
}
function analyseCohort(rows: CurveHistoryRow[], start: number) {
  const base = projectCurveHistory(rows), scope = { owner: rows[0].owner, exercise: rows[0].exercise, gym: rows[0].gym };
  assert.ok(rows.every(r => curveScopeKey(r) === curveScopeKey(scope)));
  const reference = priorCurveReference(base.points, scope, start, 52);
  const main = diagnose(base.points, start, reference.rm);
  const effects = [-1, 1].map(delta => {
    const shifted = projectCurveHistory(perturb(rows, delta)).points;
    const coupled = priorCurveReference(shifted, scope, start, 52);
    return { delta, observationOnly: diagnose(shifted, start, reference.rm),
      coupledReference: coupled, coupled: diagnose(shifted, start, coupled.rm) };
  });
  return { scope, start, rawSets: rows.length, exclusions: base.excluded, reference, main,
    effortStrata: [0, 1, 2, 3, 4].map(rir => {
      const points = projectCurveHistory(filterEffort(rows, rir)).points;
      const ref = priorCurveReference(points, scope, start, 52);
      return { rir, reference: ref, diagnostics: diagnose(points, start, ref.rm) };
    }), effortPerturbations: effects,
    lookbackSensitivity: [12, 26].map(weeks => { const ref = priorCurveReference(base.points, scope, start, weeks);
      return { weeks, reference: ref, diagnostics: diagnose(base.points, start, ref.rm) }; }),
    alternativePriorMeans: reference.rm === null ? null : diagnose(base.points, start,
      reference.selected.reduce((a, r) => a + r.best, 0) / 6) };
}
function analyseHistory(rows: CurveHistoryRow[]) {
  const groups = new Map<string, CurveHistoryRow[]>();
  for (const row of rows) { const key = curveScopeKey(row), group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  return [...groups.values()].map(group => {
    const points = projectCurveHistory(group).points;
    const dates = [...new Set(points.map(p => p.row.startedAt))].sort((a, b) => a - b);
    // Prespecified chronological 2/3 split uses dates, never residual values.
    return dates.length ? analyseCohort(group, dates[Math.floor(dates.length * 2 / 3)]) :
      { scope: { owner: group[0].owner, exercise: group[0].exercise, gym: group[0].gym }, rawSets: group.length,
        exclusions: projectCurveHistory(group).excluded, reference: null };
  });
}

const richRows = importRows(), richPoints = projectCurveHistory(richRows);
assert.equal(pkg.sessions.length, 221); assert.equal(richRows.length, 2910);
let rankMatches = 0, sourceRirRows = 0;
for (const s of pkg.sessions) for (const e of s.exercises) {
  e.sets.slice().sort((a, b) => a.orderIndex - b.orderIndex).forEach((set, rank) => {
    // Reconcile the documented original enrichment at commit25f0f103, not today's different sequence.
    const expected = rank === 0 ? 'warm_up' : rank === 1 ? null : ['rir_2', 'rir_1', 'rir_0'][Math.min(rank - 2, 2)];
    if (set.setType === expected) rankMatches++;
    if (getSessionSetRir(set.source.type) !== null) sourceRirRows++;
  });
}
assert.equal(rankMatches, richRows.length); assert.equal(sourceRirRows, 0);
const wave = waveSource.value;
assert.equal(wave.synthetic, true); assert.equal(wave.provisional, false); assert.equal(wave.prior.length, 24);
const synthetic = Object.entries(wave.scenarios as Record<string, WaveSet[]>).map(([name, sets]) => {
  assert.equal(sets.length, 72); assert.equal(new Set(sets.map(r => r.session)).size, 24);
  const rows = waveRows([...wave.prior, ...sets], `synthetic-${name}`), start = sets[0].startedAt;
  const points = projectCurveHistory(rows).points, scope = rows[0];
  const reference = priorCurveReference(points, scope, start, 52);
  assert.equal(reference.qualifyingSessions, 6); assert.ok(Math.abs(reference.rm! - 100) < 1e-8);
  const prefixes = Array.from({ length: 24 }, (_, index) => {
    const end = sets.find(r => r.week === index + 1)!.completedAt!;
    const prefix = points.filter(p => p.row.startedAt >= start && p.row.completedAt! <= end);
    const prefixSource = projectCurveHistory(rows.filter(r => r.completedAt! <= end)).points;
    assert.deepEqual(priorCurveReference(prefixSource, scope, start, 52), reference);
    assert.deepEqual(prefixSource.filter(p => p.row.startedAt >= start), prefix);
    assert.equal(prefix.length, 3 * (index + 1));
    const responses = sessionMedians(prefix.map(p => ({ session: p.row.session,
      time: (p.row.startedAt - start) / 604800000, value: curveResidual(p, reference.rm)!.percentage })));
    const time = responses.at(-1)!.time;
    const constant = fitRegression(responses, 'constant'), linear = fitRegression(responses, 'linear');
    const rm = (fit: typeof constant) => fit ? reference.rm! * (1 + predict(fit, { time, value: 0 }) / 100) : null;
    return { week: index + 1, observedSets: prefix.length, sessions: responses.length,
      constantRm: rm(constant), linearRm: rm(linear),
      curves: Array.from({ length: 10 }, (_, i) => ({ reps: i + 1,
        reference: reference.rm! / estimateOneRepMax(1, i + 1)!,
        constant: rm(constant) === null ? null : rm(constant)! / estimateOneRepMax(1, i + 1)!,
        linear: rm(linear) === null ? null : rm(linear)! / estimateOneRepMax(1, i + 1)! })) };
  });
  assert.equal(prefixes[0].constantRm, null); assert.equal(prefixes[0].observedSets, 3);
  if (name === 'stable') assert.ok(Math.abs(prefixes[23].linearRm! - 99) < 1e-8);
  if (name === 'gradual') assert.ok(Math.abs(prefixes[23].linearRm! - 122.76) < 1e-8);
  const phaseBySession = new Map(sets.map(r => [r.session, r.phase]));
  const phases = [...new Set(sets.map(r => r.phase))];
  const evaluationSensitivity = (keep: (p: CurvePoint) => boolean) =>
    diagnose(points.filter(p => p.row.startedAt < start || keep(p)), start, reference.rm);
  const withoutReset = evaluationSensitivity(p => phaseBySession.get(p.row.session) !== 'Reset');
  const supported = evaluationSensitivity(p => p.equivalentReps <= 10);
  assert.equal(withoutReset.evaluatedSessions, 18); assert.equal(supported.evaluatedSessions, 18);
  return { name, analysis: analyseCohort(rows, start), prefixes,
    evaluationCompositionSensitivity: { fixedReferenceRm: reference.rm, withoutReset, supportedEquivalentReps: supported,
      byPhase: Object.fromEntries(phases.map(phase => [phase,
        evaluationSensitivity(p => phaseBySession.get(p.row.session) === phase)])),
      limit: 'Evaluation-only composition sensitivity with the original reference. No measured tempo/pause effect or production phase filter.' },
    observations: sets.map((r, i) => ({ week: r.week, phase: r.phase, weight: Number(r.weightValue),
      reps: Number(r.repsValue), rir: getSessionSetRir(r.setType), u: Number(r.repsValue) + getSessionSetRir(r.setType)!,
      analyticalRm: points.filter(p => p.row.startedAt >= start)[i].analyticalRm })) };
});
let remote: unknown = { status: 'awaiting_identified_test_account_scope' };
if (args.length) {
  const input = loadJson(args[0].slice('--remote-input='.length));
  assert.equal(input.value.schema, 'curve-research-snapshot.v1');
  assert.ok(input.value.authorizedTestAccounts === true && Array.isArray(input.value.rows));
  const originals = new Map(richRows.map(r => [r.id, r]));
  const coordinates = (r: CurveHistoryRow & { blockOrder?: number; setOrder?: number }) => JSON.stringify([
    r.exercise, r.startedAt, r.blockOrder, r.setOrder, r.weightValue, r.repsValue, r.setType, r.performanceStatus,
  ]);
  const packageCoordinates = new Set(richRows.map(coordinates));
  const matched = input.value.rows.filter((r: CurveHistoryRow) => packageCoordinates.has(coordinates(r)));
  const unmatched = input.value.rows.filter((r: CurveHistoryRow) => !packageCoordinates.has(coordinates(r)));
  remote = { provenance: input.value.provenance, snapshotSha256: input.sha256,
    originAudit: { matchedPackageIds: input.value.rows.filter((r: CurveHistoryRow) => originals.has(r.id)).length,
      matchedTimestampExerciseOrderAndValues: matched.length, unmatchedRows: unmatched.length,
      interpretation: 'Coordinate overlap with the rank-enriched package is evidence to audit, not authenticated source identity. Unmatched/native rows are not independently verified RIR.' },
    inventory: { rows: input.value.rows.length, ...projectCurveHistory(input.value.rows).excluded },
    cohorts: analyseHistory(input.value.rows), unmatchedOnly: analyseHistory(unmatched) };
}
console.log(JSON.stringify({ calendar: 'Europe/London', workingPolicy: 'declared personal defaults; device choices unavailable remotely',
  inventory: { richHistory: { sha256: importSource.sha256, sessions: pkg.sessions.length, sets: richRows.length,
    effortCounts: count(richRows.map(r => String(r.setType))), analyticalSets: richPoints.points.length,
    exclusions: richPoints.excluded, exerciseGymCohorts: new Set(richRows.map(curveScopeKey)).size,
    originalRankRuleMatches: rankMatches, sourceRirRows, provenance: 'GymBook-labelled history; all efforts match old synthetic rank enrichment; original export not authenticated',
    metadata: 'current dev seed recipe, not a recovered historical exercise snapshot' },
    wave: { sha256: waveSource.sha256, priorSets: 24, priorSessions: 8, qualifyingPriorSessions: 6,
      scenarios: 3, setsPerScenario: 72, sessionsPerScenario: 24, synthetic: true, provisional: false } },
  richHistory: analyseHistory(richRows), synthetic, remote,
  limits: 'Set distributions are descriptive; regressions use session medians. RM curves retain the adopted shape. No ground-truth RIR, confidence intervals, statistically significant breaks or production UI. Weekly fitted curves use only completed prefixes and a fixed independent prior reference.' }, null, 2));
