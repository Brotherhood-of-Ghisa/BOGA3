import { estimateOneRepMax } from '../src/exercise-calculations/index.ts';
import { DEFAULT_PERSONAL_EFFORT_POLICY } from '../src/exercise-calculations/effort-policy.ts';
import { createAsOfWeightResolver } from '../src/bodyweight/as-of.ts';
import { curveResidual, priorCurveReference, projectCurveHistory, type CurveHistoryRow } from './helpers/curve-history-research.ts';

const start = new Date(2026, 5, 1, 12).getTime();
const row = (id: string, overrides: Partial<CurveHistoryRow> = {}): CurveHistoryRow => ({
  owner: 'test-a', exercise: 'squat', gym: 'gym-a', session: id, block: `${id}-block`, id,
  startedAt: start - 7 * 86400000, completedAt: start - 7 * 86400000 + 3600000, status: 'completed', deleted: false,
  weightValue: '80', repsValue: '6', setType: 'rir_1', performanceStatus: null,
  loadInputMode: 'total_load', bodyweightContribution: 0, bodyweightEnabled: false, bodyWeightKg: null, ...overrides,
});
const priors = Array.from({ length: 6 }, (_, i) => row(`prior-${i}`, {
  startedAt: start - (i + 1) * 7 * 86400000, completedAt: start - (i + 1) * 7 * 86400000 + 3600000,
}));
const scope = { owner: 'test-a', exercise: 'squat', gym: 'gym-a' };

describe('research history extraction and independent curve references', () => {
  it('excludes missing/unknown effort, planned, deleted, active and unlinked rows without target imputation', () => {
    const rows = [row('ok'), row('missing', { setType: null }), row('unknown', { setType: 'working' }),
      row('planned', { performanceStatus: 'planned' }), row('deleted', { deleted: true }),
      row('active', { completedAt: null }), row('unlinked', { exercise: null }), row('invalid', { repsValue: '6.5' })];
    const result = projectCurveHistory(rows);
    expect(result.points.map(p => p.row.id)).toEqual(['ok']);
    expect(result.excluded).toEqual({ missing_effort: 1, unknown_effort: 1, not_performed_working: 2,
      deleted_graph: 1, not_completed: 1, unlinked_exercise: 1 });
    expect(rows[1].setType).toBeNull();
  });

  it('uses actual reps for logged RM and preserves numeric high RIR and account effort policy', () => {
    const points = projectCurveHistory([1, 2, 3, 7].map(n => row(`rir-${n}`, { setType: `rir_${n}` }))).points;
    expect(points.map(p => p.existingRm)).toEqual(Array(4).fill(estimateOneRepMax(80, 6)));
    expect(points.map(p => p.equivalentReps)).toEqual([7, 8, 9, 13]);
    expect(points[0].analyticalRm).toBeLessThan(points[1].analyticalRm);
    expect(projectCurveHistory([row('excluded')], { ...DEFAULT_PERSONAL_EFFORT_POLICY, workingSetEfforts: [] }).points).toEqual([]);
    expect(projectCurveHistory([row('zero', { weightValue: '' })]).points[0].analyticalRm).toBe(0);
  });

  it('preserves owner identity, repeated blocks and rejects extraction duplication', () => {
    const copies = [row('same'), row('same', { owner: 'test-b' }), row('extra', { session: 'same', block: 'second' })];
    expect(projectCurveHistory(copies).points).toHaveLength(3);
    expect(() => projectCurveHistory([copies[0], { ...copies[0] }])).toThrow('duplicate set');
  });

  it('selects six prior session bests in one exercise/gym/account, excludes tied cutoff and future data', () => {
    const evaluated = row('evaluation', { startedAt: start, completedAt: start + 3600000, weightValue: '150' });
    const others = [row('other-owner', { owner: 'test-b', weightValue: '200' }), row('other-gym', { gym: null }),
      row('other-exercise', { exercise: 'bench' }), row('tied', { completedAt: start }),
      row('outside-support', { setType: 'rir_7' }), row('zero', { weightValue: '0' })];
    const first = priorCurveReference(projectCurveHistory([...priors, evaluated, ...others]).points, scope, start, 52);
    expect(first.qualifyingSessions).toBe(6);
    expect(first.rm).toBeCloseTo(estimateOneRepMax(80, 7)!);
    expect(priorCurveReference(projectCurveHistory([...priors, evaluated]).points, scope, start, 52)).toEqual(first);
    expect(priorCurveReference(projectCurveHistory(priors.slice(1)).points, scope, start, 52).rm).toBeNull();
    expect(priorCurveReference(projectCurveHistory(priors).points, scope, start, 1).rm).toBeNull();
    const repeated = row('repeated-block', { session: priors[0].session, weightValue: '90' });
    expect(priorCurveReference(projectCurveHistory([...priors, repeated]).points, scope, start, 52).qualifyingSessions).toBe(6);
  });

  it('resolves dated bodyweight through the existing selector and applies per-side conversion once', () => {
    const resolve = createAsOfWeightResolver([{ id: 'earlier', measuredAt: start - 1, weightKg: 70 },
      { id: 'later', measuredAt: start + 1, weightKg: 90 }]);
    const bodyWeightKg = resolve(start).bodyWeightKg;
    const [point] = projectCurveHistory([row('body', { startedAt: start, completedAt: start + 1,
      weightValue: '10', loadInputMode: 'per_side_load', bodyweightContribution: 1, bodyweightEnabled: true, bodyWeightKg })]).points;
    expect(point.load).toBe(90);
    expect(point.factor).toBe(2);
    const residual = curveResidual(point, point.analyticalRm)!;
    expect(residual.signedKg).toBeCloseTo(0);
    expect(residual.percentage).toBeCloseTo(0);
    expect(point.existingRm).toBeCloseTo((estimateOneRepMax(90, 6)! - 70) / 2);
    expect(projectCurveHistory([{ ...point.row, bodyWeightKg: null }]).points[0].load).toBe(20);
    expect(curveResidual(point, null)).toBeNull();
    expect(() => curveResidual(point, 0)).toThrow();
  });
});
