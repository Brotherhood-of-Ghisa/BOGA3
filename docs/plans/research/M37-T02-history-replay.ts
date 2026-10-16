import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isWorkingSet } from '../../../apps/mobile/src/exercise-calculations/set-semantics.ts';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '../../../apps/mobile/src/exercise-calculations/effort-policy.ts';
import { curveScopeKey, projectCurveHistory, type CurveHistoryRow } from '../../../apps/mobile/__tests__/helpers/curve-history-research.ts';
import { fitStrengthRegimes, type RegimeSession } from '../../../apps/mobile/__tests__/helpers/segmented-curve-research.ts';
assert.equal(process.env.TZ, 'Europe/London');
assert.ok(process.env.REGIME_PRIVATE_ROOT);
const root = new URL('../../../', import.meta.url), privateRoot = process.env.REGIME_PRIVATE_ROOT!;
const bytes = readFileSync(join(privateRoot, 'remote-private-snapshot.json'));
const previous = JSON.parse(readFileSync(join(privateRoot, 't03-private-results.json'), 'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), previous.remote.snapshotSha256);
const snapshot = JSON.parse(bytes.toString());
assert.equal(snapshot.authorizedTestAccounts, true);
assert.equal(new Set(snapshot.rows.map((r: CurveHistoryRow) => r.owner)).size, 1);
const summarize = (sessions: RegimeSession[]) => (['fixed', 'joint'] as const).map(method => {
  const fit = fitStrengthRegimes(sessions, { method });
  return { method, status: fit.status, inputSessions: fit.inputSessions, sampledSessions: fit.sampledSessions,
    cutCount: fit.cutProfile.length, rawEvidence: fit.evidence,
    candidate: fit.candidate ? { strengths: fit.candidate.controls, left: fit.candidate.leftTime, right: fit.candidate.rightTime } : null };
});
const historical = previous.remote.cohorts.map((cohort: any, index: number) => {
  const rows = (snapshot.rows as (CurveHistoryRow & { blockOrder: number; setOrder: number })[])
    .filter(r => curveScopeKey(r) === curveScopeKey(cohort.scope) && r.startedAt >= cohort.start);
  const projected = projectCurveHistory(rows).points;
  const working = rows.filter(r => !r.deleted && r.status === 'completed' && isWorkingSet({ weight: r.weightValue,
    reps: r.repsValue, setType: r.setType, performanceStatus: r.performanceStatus }, DEFAULT_PERSONAL_EFFORT_POLICY));
  working.sort((a, b) => a.blockOrder - b.blockOrder || a.setOrder - b.setOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = new Map<string, typeof working[number]>();
  for (const row of working) if (!first.has(row.session)) first.set(row.session, row);
  const sessions = [...first.values()].map(row => {
    const point = projected.find(p => p.row.id === row.id);
    if (point) assert.equal(point.factor * (point.row.loadInputMode === 'per_side_load' ? 1.25 : 2.5), 2.5);
    return { sessionId: row.session, time: new Date(row.startedAt).getTime(), firstWorkingSet: point
      ? { setId: row.id, reps: point.reps, rir: point.rir, load: point.load } : null };
  });
  return { cohort: `C${index + 1}`, exercise: index < 3 ? 'Zercher Squat' : 'Dumbbell Bench Press', fits: summarize(sessions) };
});
assert.ok(historical.every((c: any) => c.fits.every((f: any) => f.cutCount === 0)));
const fixture = readFileSync(new URL('apps/mobile/__tests__/fixtures/rm-curve-weekly-wave.json', root));
const fixtureSha256 = createHash('sha256').update(fixture).digest('hex');
assert.equal(fixtureSha256, '1701f0287aeedc5ebb98a86d23a5fa18eb640cf319f22350662fdb7cfe452fce');
const wave = JSON.parse(fixture.toString());
const synthetic = Object.entries(wave.scenarios).map(([name, data]) => {
  const rows = data as any[];
  const prefixes = Array.from({ length: 24 }, (_, i) => {
    const sets = rows.filter(s => s.week <= i + 1);
    const first = sets.filter(s => s.set === 1).map(s => ({ sessionId: s.session, time: new Date(s.startedAt).getTime(),
      firstWorkingSet: { setId: `${s.session}:1`, reps: s.reps, rir: s.rir, load: s.load } }));
    return { week: i + 1, displayedSets: sets.length, fits: summarize(first) };
  });
  return { name, prefixes };
});
assert.equal(synthetic.reduce((n, s) => n + s.prefixes.length, 0), 72);
console.log(JSON.stringify({ historical, synthetic, fixtureSha256,
  limit: 'Authorized local replay only; no new query. Frozen programme is a logged equivalence example, not physiological break truth. Sparse private effort cannot validate error or structural inference.' }, null, 2));
