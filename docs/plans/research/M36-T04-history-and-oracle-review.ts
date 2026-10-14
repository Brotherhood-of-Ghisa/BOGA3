// Read-only continuation of the authorized private snapshot and shared synthetic history.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { estimateOneRepMax } from '../../../apps/mobile/src/exercise-calculations/index.ts';
import { isWorkingSet } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { priorCurveReference, projectCurveHistory, curveScopeKey, type CurveHistoryRow } from '../../../apps/mobile/__tests__/helpers/curve-history-research.ts';
import { fitRegression, median, scanBreaks } from '../../../apps/mobile/__tests__/helpers/residual-regression-research.ts';
import { DEFAULT_ENTRY_LOAD_SD_KG, jointUncertaintyProfiles, profileSet } from '../../../apps/mobile/__tests__/helpers/curve-inference-research.ts';

assert.equal(process.env.TZ, 'Europe/London');
assert.equal(process.argv.length, 2);
const root = new URL('../../../', import.meta.url);
const bytes = readFileSync(new URL('docs/plans/research/M36-weekly-wave-example.json', root));
const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(fixtureSha256, '172dae999afb8e2a0a3dcf34ced8c474f17eca76c04a68aa17edc753e144ae26');
const wave = JSON.parse(bytes.toString());
assert.equal(wave.synthetic, true); assert.equal(wave.provisional, true);
const results = JSON.parse(readFileSync(new URL('apps/mobile/artifacts/research/m36-t04/t03-private-results.json', root), 'utf8'));
const snapshotBytes = readFileSync(new URL('apps/mobile/artifacts/research/m36-t04/remote-private-snapshot.json', root));
assert.equal(createHash('sha256').update(snapshotBytes).digest('hex'), results.remote.snapshotSha256);
const snapshot = JSON.parse(snapshotBytes.toString());
assert.equal(snapshot.schema, 'curve-research-snapshot.v1'); assert.equal(snapshot.authorizedTestAccounts, true);
assert.equal(new Set(snapshot.rows.map((r: CurveHistoryRow) => r.owner)).size, 1);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-8, `${a} != ${b}`);
const syntheticScope = { owner: 'synthetic', exercise: 'synthetic', gym: 'synthetic-gym' };
const syntheticRows: CurveHistoryRow[] = [...wave.prior, ...wave.scenarios.plateau].map((s: any) => ({ ...s,
  ...syntheticScope, block: s.session, id: `${s.session}:${s.set}`, deleted: false, status: 'completed',
  bodyweightEnabled: false, bodyWeightKg: null }));
const syntheticPoints = projectCurveHistory(syntheticRows).points, start = wave.scenarios.plateau[0].startedAt;
const completeReference = priorCurveReference(syntheticPoints, syntheticScope, start, 52);
assert.equal(completeReference.rm, 100); assert.equal(completeReference.qualifyingSessions, 6);
const insufficient = priorCurveReference(syntheticPoints.filter(p => p.row.session !== completeReference.selected[0].session), syntheticScope, start, 52);
assert.equal(insufficient.qualifyingSessions, 5); assert.equal(insufficient.rm, null);
const referenceOracle = { complete: { support: 6, rm: 100 }, insufficient: { support: 5, rm: null } };

const oracle = results.synthetic.map((s: { name: string; prefixes: any[]; analysis: any }) => {
  assert.equal(s.prefixes.length, 24); assert.equal(s.analysis.reference.rm, 100);
  s.prefixes.forEach((p, i) => {
    assert.equal(p.week, i + 1); assert.equal(p.sessions, i + 1); assert.equal(p.observedSets, (i + 1) * 3);
    p.curves.forEach((c: any) => close(c.reference, 100 / estimateOneRepMax(1, c.reps)!));
  });
  assert.equal(s.prefixes[0].constantRm, null);
  if (s.name === 'stable') close(s.prefixes[23].linearRm, 99);
  if (s.name === 'gradual') close(s.prefixes[23].linearRm, 122.76);
  return { name: s.name, referenceRm: 100, weekly: s.prefixes.map(p => ({ week: p.week,
    sets: p.observedSets, sessions: p.sessions, constantAnalyticalRm: p.constantRm, linearAnalyticalRm: p.linearRm })) };
});
const strengthSets = wave.scenarios.plateau.filter((s: any) => s.phase === 'Strength' && s.set === 1);
assert.deepEqual(strengthSets.map((s: any) => s.rir), [1, 1, 2, 3, 1, 2]);
strengthSets.slice(0, 4).forEach((s: any) => close(s.load, strengthSets[0].load));
close(strengthSets[3].analyticalRm, strengthSets[4].analyticalRm);
assert.ok(strengthSets[4].load > strengthSets[3].load);
const plateauProgression = strengthSets.map((s: any) => ({ week: s.week, reps: s.reps, rir: s.rir,
  load: s.load, analyticalRm: estimateOneRepMax(s.load, s.reps + s.rir), existingRm: estimateOneRepMax(s.load, s.reps) }));
const expected = JSON.parse(readFileSync(new URL('docs/plans/research/M36-T04-weekly-wave-oracle.json', root), 'utf8'));
assert.deepEqual({ fixtureSha256, oracle, plateauProgression, referenceOracle }, {
  fixtureSha256: expected.fixtureSha256, oracle: expected.oracle, plateauProgression: expected.plateauProgression,
  referenceOracle: expected.referenceOracle });

const historical = results.remote.cohorts.map((cohort: any, index: number) => {
  const rows = (snapshot.rows as (CurveHistoryRow & { blockOrder: number; setOrder: number })[])
    .filter(r => curveScopeKey(r) === curveScopeKey(cohort.scope) && r.startedAt >= cohort.start);
  const projected = projectCurveHistory(rows).points;
  const working = rows.filter(r => !r.deleted && r.status === 'completed' && isWorkingSet({ weight: r.weightValue,
    reps: r.repsValue, setType: r.setType, performanceStatus: r.performanceStatus }, DEFAULT_PERSONAL_EFFORT_POLICY));
  const firstBySession = new Map<string, string>();
  working.sort((a, b) => a.blockOrder - b.blockOrder || a.setOrder - b.setOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of working) if (!firstBySession.has(row.session)) firstBySession.set(row.session, row.id);
  const first = projected.filter(p => firstBySession.get(p.row.session) === p.row.id);
  first.forEach(p => assert.equal(p.factor * DEFAULT_ENTRY_LOAD_SD_KG[p.row.loadInputMode], 2.5));
  const responses = cohort.main.sessionResponses.map((r: { time: number; value: number }) => ({
    time: r.time, value: (1 + r.value / 100) * cohort.reference.rm }));
  const points = first.map(p => ({ load: p.load, recordedRir: p.rir,
    multipliers: Array.from({ length: 5 }, (_, r) => estimateOneRepMax(1, p.reps + r)!) }));
  const center = points.length ? median(first.map(p => p.analyticalRm)) : null;
  const strengthAxis = center === null ? [] : Array.from({ length: 101 }, (_, i) => center * (0.5 + i * 0.01));
  const sigmas = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
  const loadSds = [0.5, 1.25, 2.5, 3.75, 5, 7.5];
  return { cohort: `C${index + 1}`, exercise: index < 3 ? 'Zercher Squat' : 'Dumbbell Bench Press',
    independentSessions: cohort.main.evaluatedSessions, sets: cohort.main.evaluatedSets,
    priorReferenceSupport: cohort.reference.qualifyingSessions, referenceRm: cohort.reference.rm,
    firstWorkingSessions: firstBySession.size, firstWorkingWithEffort: first.length,
    analyticalRegression: responses.length ? { constant: fitRegression(responses, 'constant'),
      linear: fitRegression(responses, 'linear'), quadratic: fitRegression(responses, 'quadratic'),
      searchedCandidates: scanBreaks(responses, 8).length } : null,
    relativeLikelihood: points.length ? (() => {
      const { cube, strengthProfile, sigmaProfile, loadProfile } = jointUncertaintyProfiles(points, strengthAxis, sigmas, loadSds);
      const grid = cube[loadSds.indexOf(2.5)], loadMaximum = profileSet(loadSds, loadProfile, 0);
      return { fixedTotalLoadSd: 2.5, enteredLoadSds: DEFAULT_ENTRY_LOAD_SD_KG, strengthAxis, sigmas, loadSds,
        fixedSigma1Profile: grid[sigmas.indexOf(1)], strengthProfile, sigmaProfile, loadProfile,
        fixedMaximum: profileSet(strengthAxis, grid[sigmas.indexOf(1)], 0)?.estimate ?? null,
        jointMaximum: profileSet(strengthAxis, strengthProfile, 0)?.estimate ?? null,
        jointSigmaMaximum: profileSet(sigmas, sigmaProfile, 0)?.estimate ?? null,
        jointTotalLoadMaximum: loadMaximum?.estimate ?? null,
        loadGridBoundary: loadMaximum?.lowerBoundary || loadMaximum?.upperBoundary };
    })() : null,
    limits: 'Observed A and relative profiles only; no calibrated interval or empirical noise/strength/break claim. Load-error grid boundaries are unresolved, not zero error. Missing first effort does not substitute a later set. No fallback reference.' };
});
assert.ok(historical.every((h: any) => h.analyticalRegression === null || h.analyticalRegression.searchedCandidates === 0));
assert.equal(historical.find((h: any) => h.referenceRm !== null).independentSessions, 7);
console.log(JSON.stringify({ fixtureSha256, freezeStatus: 'candidate oracle; final human approval pending',
  oracle, plateauProgression, referenceOracle, historical, limits: 'Private snapshot stays local; anonymized cohort labels do not verify effort provenance.' },
  (_, value) => value === -Infinity ? '-Infinity' : value, 2));
