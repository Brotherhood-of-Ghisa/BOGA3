import wave from './fixtures/rm-curve-weekly-wave.json';
import oracle from './fixtures/rm-curve-weekly-wave-oracle.json';
import { waveGraph } from './helpers/rm-curve-history';
import { buildRmCurveModel, rmCurvePriorStart, rmCurveWindow } from '@/src/rm-curve/model';
import { predictRmCurveLoad, projectRmCurveSet, rmCurveKnots, rmCurveResidual } from '@/src/exercise-calculations/rm-curve';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '@/src/exercise-calculations/effort-policy';
import vectors from '@/src/exercise-calculations/load-metrics-vectors.json';
import { calculateSetMetrics, type SetMetricInput } from '@/src/exercise-calculations/load-metrics';
import { estimateOneRepMax } from '@/src/exercise-calculations';
import { historyWeekBounds, shiftCalendarWeeks } from '@/src/utils/calendar-weeks';

const scope = { start: new Date(wave.scenarios.plateau[0].startedAt),
  end: new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1), historyLookbackWeeks: 52 };
const input = { policy: 'ordinary' as const, loadInputMode: 'total_load' as const,
  bodyweightContribution: 0, weightValue: '80', repsValue: '6', setType: 'rir_1' };

it.each(vectors)('projects the established load vector: $name', vector => {
  const input = { ...vector, setType: 'rir_1' } as SetMetricInput;
  const actual = calculateSetMetrics(input); const projected = projectRmCurveSet(input);
  if (!actual.eligible || actual.load.status !== 'known' || actual.estimatedOneRepMaxKg === null) {
    expect(projected).toBe('invalid_metrics'); return;
  }
  if (typeof projected === 'string') throw Error(projected);
  const factor = input.loadInputMode === 'per_side_load' ? 2 : 1;
  expect(projected.loadKg).toBe(actual.load.calculatedLoadKg / factor);
  expect(projected.existingOneRepMax).toBe(actual.estimatedOneRepMaxKg);
  expect(projected.weightKg).toBe(actual.load.enteredWeightKg);
  expect(projected.equivalentReps).toBe(actual.reps + 1);
  expect(projected.analyticalTotalRm).toBe(estimateOneRepMax(actual.load.calculatedLoadKg, actual.reps + 1));
  if (projected.analyticalTotalRm > 0) expect(predictRmCurveLoad(projected.analyticalTotalRm, projected.equivalentReps, input.loadInputMode))
    .toBeCloseTo(projected.loadKg, 8);
});

it('matches every frozen weekly prefix without a later-set/reference leak for all controls', () => {
  for (const control of oracle.oracle) {
    const name = control.name as keyof typeof wave.scenarios;
    const graph = waveGraph(name);
    for (const expected of control.weekly) {
      const end = new Date(wave.scenarios[name][expected.week * 3 - 1].completedAt + 1);
      const model = buildRmCurveModel(graph, { ...scope, end });
      expect(model.observations).toHaveLength(expected.sets);
      expect(new Set(model.observations.map(row => row.sessionId)).size).toBe(expected.sessions);
      expect(model.reference.totalRm).toBe(100);
      expect(model.reference.qualifyingSessions).toBe(6);
      for (const point of model.observations) {
        const original = wave.scenarios[name].find(row => `${row.session}:${row.set}` === point.setId)!;
        expect(point.analyticalTotalRm).toBeCloseTo(original.analyticalRm, 8);
        expect(point.existingOneRepMax).toBeCloseTo(original.rm, 8);
        expect(point.weightValue).toBe(original.weightValue);
        expect(point.setType).toBe(original.setType);
        expect(point.residual?.percentage).toBeCloseTo(100 * (original.analyticalRm / 100 - 1), 8);
      }
    }
  }
});

it('keeps distinct repeated-block sets and counts one best per prior session, with no sparse fallback', () => {
  const graph = waveGraph(); const full = buildRmCurveModel(graph, scope);
  expect(new Set(full.observations.map(p => p.setId)).size).toBe(72);
  expect(full.reference.selectedSessions).toHaveLength(6);
  const removed = full.reference.selectedSessions[0].sessionId;
  const sparse = buildRmCurveModel({ ...graph, rows: graph.rows.filter(r => r.sessionId !== removed) }, scope);
  expect(sparse.reference.totalRm).toBeNull(); expect(sparse.reference.qualifyingSessions).toBe(5);
  expect(sparse.observations).toHaveLength(72); expect(sparse.curve).toEqual([]);
  expect(sparse.observations.every(p => p.residual === null)).toBe(true);
});

it('retains a positive reference when six raw singles are at the smallest representable load', () => {
  const graph = waveGraph();
  graph.rows = graph.rows.filter(row => row.completedAt < scope.start && row.blockOrder === 0 && row.setOrder === 0).slice(0, 6)
    .map(row => ({ ...row, weightValue: '0.' + '0'.repeat(323) + '5', repsValue: '1', setType: 'rir_0' }));
  expect(buildRmCurveModel(graph, scope).reference).toMatchObject({ totalRm: Number.MIN_VALUE, qualifyingSessions: 6 });
});

it('scopes gym and RIR identically for observations and priors and retains missing/unknown exclusions', () => {
  const graph = waveGraph(); const row = graph.rows.at(-1)!;
  graph.rows.push({ ...row, setId: 'missing', setType: null }, { ...row, setId: 'unspecified', setType: 'unspecified' },
    { ...row, setId: 'unknown', setType: 'RIR-1' }, { ...row, setId: 'high', setType: 'rir_12' },
    { ...row, setId: 'unsafe', setType: `rir_${Number.MAX_SAFE_INTEGER}` },
    { ...row, setId: 'other-gym', gymId: null });
  const all = buildRmCurveModel(graph, { ...scope, gymId: 'synthetic-gym' });
  expect(all.excluded).toMatchObject({ missing_effort: 2, unknown_effort: 1, equivalent_reps_overflow: 1 });
  expect(all.effortOptions).toContain(12);
  const high = buildRmCurveModel(graph, { ...scope, gymId: 'synthetic-gym', rir: 12 });
  expect(high.observations.map(p => p.setId)).toEqual(['high']); expect(high.reference.totalRm).toBeNull();
  expect(buildRmCurveModel(graph, { ...scope, gymId: null }).observations.map(p => p.setId)).toEqual(['other-gym']);
  const filtered = buildRmCurveModel(graph, { ...scope, gymId: 'synthetic-gym', rir: 0 });
  expect(filtered.observations.map(row => row.setId)).toEqual(wave.scenarios.plateau.filter(row => row.rir === 0)
    .sort((a, b) => b.completedAt - a.completedAt || a.set - b.set).map(row => `${row.session}:${row.set}`));
  expect(filtered.reference.totalRm).toBeNull();
  expect(buildRmCurveModel(graph, { ...scope, gymId: 'synthetic-gym', rir: 9 }).observations).toEqual([]);
});

it('reads an unset gym as every gym including No gym', () => {
  // The three-state convention (spec 09): unset every gym, null no gym, an id that gym.
  const graph = waveGraph(); const newest = graph.rows.reduce((a, b) => (b.completedAt > a.completedAt ? b : a));
  const window = { ...scope, end: new Date(scope.end.getTime() + 10) };
  graph.rows.push({ ...newest, sessionId: 'no-gym-session', setId: 'no-gym-newest', gymId: null, gymName: null,
    startedAt: new Date(newest.completedAt.getTime() + 1), completedAt: new Date(newest.completedAt.getTime() + 5) });
  const every = buildRmCurveModel(graph, window);
  expect(every.gymId).toBeUndefined();
  expect(every.observations.map(p => p.setId)).toEqual(expect.arrayContaining(['no-gym-newest', newest.setId]));
  expect(every.observations).toHaveLength(buildRmCurveModel(graph, { ...window, gymId: 'synthetic-gym' }).observations.length + 1);
  expect(buildRmCurveModel(graph, { ...window, gymId: null }).observations.map(p => p.setId)).toEqual(['no-gym-newest']);
});

it('preserves singles, zero load and per-side/bodyweight coordinates and residuals', () => {
  expect(projectRmCurveSet({ ...input, repsValue: '1', setType: 'rir_0' })).toMatchObject({ analyticalTotalRm: 80, existingOneRepMax: 80 });
  expect(projectRmCurveSet({ ...input, repsValue: '1', setType: 'rir_2' })).toMatchObject({ reps: 1, equivalentReps: 3, existingOneRepMax: 80 });
  const point = projectRmCurveSet({ ...input, policy: 'personal', bodyweightContribution: 0.25, bodyWeightKg: 80,
    loadInputMode: 'per_side_load', weightValue: '40', repsValue: '1', setType: 'rir_0' });
  expect(point).toMatchObject({ weightKg: 40, loadKg: 50, calculatedLoadKg: 100, analyticalTotalRm: 100, existingOneRepMax: 40 });
  if (typeof point === 'string') throw Error(point);
  expect(rmCurveResidual(point, 120, 'per_side_load')).toMatchObject({ predictedLoadKg: 60, signedKg: -10 });
  expect(rmCurveResidual(point, 120, 'per_side_load')!.percentage).toBeCloseTo(-100 / 6);
  const zero = projectRmCurveSet({ ...input, weightValue: '' });
  expect(zero).toMatchObject({ loadKg: 0, analyticalTotalRm: 0, weightKg: 0 });
  if (typeof zero === 'string') throw Error(zero);
  expect(rmCurveResidual(zero, 100, 'total_load')?.percentage).toBe(-100);
  expect(predictRmCurveLoad(100, 1, 'total_load')).toBe(100);
  const huge = projectRmCurveSet({ ...input, weightValue: '9'.repeat(308), repsValue: '1', setType: 'rir_0' });
  if (typeof huge === 'string') throw Error(huge);
  expect(rmCurveResidual(huge, 1, 'total_load')).toEqual({ predictedLoadKg: 1, signedKg: huge.loadKg, percentage: null });
});

it('rejects nonperformed, nonworking, corrupt, overflow and noncanonical inputs without inventing values', () => {
  for (const performanceStatus of ['planned', 'skipped', 'unperformed'] as const)
    expect(projectRmCurveSet({ ...input, performanceStatus })).toBe('not_working');
  expect(projectRmCurveSet({ ...input, weightValue: '-1' })).toBe('not_working');
  expect(projectRmCurveSet({ ...input, setType: 'warm_up' })).toBe('not_working');
  expect(projectRmCurveSet({ ...input, bodyweightContribution: -1 })).toBe('invalid_metrics');
  expect(projectRmCurveSet({ ...input, loadInputMode: 'per_side_load', weightValue: '9'.repeat(308) })).toBe('invalid_metrics');
  expect(projectRmCurveSet({ ...input, repsValue: '1', weightValue: '9'.repeat(307), setType: 'rir_12' })).toBe('invalid_metrics');
  expect(projectRmCurveSet({ ...input, setType: 'rir_01' })).toBe('unknown_effort');
  expect(projectRmCurveSet({ ...input, setType: null })).toBe('missing_effort');
  expect(projectRmCurveSet({ ...input, effortPolicy: { ...DEFAULT_PERSONAL_EFFORT_POLICY, workingSetEfforts: [] } })).toBe('not_working');
  for (const rm of [null, 0, -1, Infinity, NaN]) expect(predictRmCurveLoad(rm, 5, 'total_load')).toBeNull();
  expect(predictRmCurveLoad(100, 1.5, 'total_load')).toBeNull();
  expect(predictRmCurveLoad(100, Number.MAX_SAFE_INTEGER + 1, 'total_load')).toBeNull();
  expect(rmCurveKnots(100, 'total_load', Number.MAX_SAFE_INTEGER)).toHaveLength(84);
  expect(rmCurveKnots(100, 'total_load', NaN)).toEqual([]);
});

it('clamps the approved ranges to local History bounds and anchors the prior interval independently', () => {
  const now = new Date(2026, 9, 14, 12);
  const normal = rmCurveWindow(52, now);
  expect(normal.start).toEqual(historyWeekBounds(52, now).start);
  for (const range of [4, 12, 24] as const) expect(rmCurveWindow(52, now, range).start).toEqual(shiftCalendarWeeks(now, -range));
  const clamped = rmCurveWindow(2, now, 24);
  expect(clamped.start).toEqual(historyWeekBounds(2, now).start);
  expect(rmCurveWindow(52, now, 'history').start).toEqual(historyWeekBounds(52, now).start);
  expect(rmCurvePriorStart(normal)).toEqual(historyWeekBounds(52, normal.start).start);
  expect(() => rmCurveWindow(0, now)).toThrow(); expect(() => rmCurveWindow(521, now)).toThrow();
  expect(() => rmCurveWindow(52, new Date(NaN))).toThrow();
  expect(() => rmCurvePriorStart({ ...scope, end: scope.start })).toThrow();
  expect(() => rmCurvePriorStart({ ...scope, rir: -1 })).toThrow();
});

it('orders tied dates by session, block, set order and binary ID and does not accept malformed session times', () => {
  const graph = waveGraph(); const row = graph.rows.at(-1)!;
  const test = { ...graph, rows: [{ ...row, setId: 'b', setOrder: 0 }, { ...row, setId: 'a', setOrder: 0 },
    { ...row, setId: 'first-block', blockOrder: 0, setOrder: 99 }, { ...row, setId: 'bad-date', startedAt: new Date(NaN) },
    { ...row, setId: 'future-start', startedAt: new Date(row.completedAt.getTime() + 1) }] };
  expect(buildRmCurveModel(test, scope).observations.map(p => p.setId)).toEqual(['first-block', 'a', 'b']);
});
