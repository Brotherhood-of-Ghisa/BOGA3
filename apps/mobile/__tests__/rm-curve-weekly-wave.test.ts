import wave from './fixtures/rm-curve-weekly-wave.json';
import oracle from './fixtures/rm-curve-weekly-wave-oracle.json';
import { priorCurveReference, projectCurveHistory, type CurveHistoryRow } from './helpers/curve-history-research';
import { fitRegression, predict, sessionMedians } from './helpers/residual-regression-research';

const scope = { owner: 'synthetic', exercise: 'synthetic', gym: 'synthetic-gym' };
const start = wave.scenarios.plateau[0].startedAt;
const rows = (sets: typeof wave.prior): CurveHistoryRow[] => sets.map(s => ({ ...s, ...scope,
  block: s.session, id: `${s.session}:${s.set}`, status: 'completed', deleted: false,
  bodyweightEnabled: false, bodyWeightKg: null, loadInputMode: 'total_load' }));

describe('frozen weekly RM-curve validation history', () => {
  it('preserves held-load RIR progress, higher-load equivalence and unchanged logged-rep metrics', () => {
    expect(wave.synthetic).toBe(true);
    expect(wave.provisional).toBe(false);
    const sets = wave.scenarios.plateau.filter(s => s.phase === 'Strength' && s.set === 1);
    const points = projectCurveHistory(rows(sets)).points;
    expect(points.map(p => p.rir)).toEqual([1, 1, 2, 3, 1, 2]);
    points.forEach((p, i) => {
      expect(p.analyticalRm).toBeCloseTo(oracle.plateauProgression[i].analyticalRm, 8);
      expect(p.existingRm).toBeCloseTo(oracle.plateauProgression[i].existingRm, 8);
    });
    expect(points.slice(0, 4).map(p => p.load)).toEqual(Array(4).fill(points[0].load));
    expect(points[4].load).toBeGreaterThan(points[3].load);
    expect(points[4].analyticalRm).toBeCloseTo(points[3].analyticalRm, 8);
  });

  it('matches every completed prefix without future leakage in all three controls', () => {
    for (const scenario of oracle.oracle) {
      const input = wave.scenarios[scenario.name as keyof typeof wave.scenarios];
      const all = projectCurveHistory(rows([...wave.prior, ...input])).points;
      scenario.weekly.forEach(expected => {
        const cutoff = input[(expected.week - 1) * 3].startedAt;
        const points = all.filter(p => p.row.startedAt >= start && p.row.startedAt <= cutoff);
        const sessions = sessionMedians(points.map(p => ({ session: p.row.session,
          time: (p.row.startedAt - start) / 604800000, value: p.analyticalRm })));
        expect(points).toHaveLength(expected.sets);
        expect(sessions).toHaveLength(expected.sessions);
        expect(priorCurveReference(all, scope, start, 52).rm).toBe(100);
        for (const [model, target] of [['constant', expected.constantAnalyticalRm], ['linear', expected.linearAnalyticalRm]] as const) {
          const fit = fitRegression(sessions, model);
          if (target === null) expect(fit).toBeNull();
          else expect(predict(fit!, { time: expected.week - 1, value: 0 })).toBeCloseTo(target, 8);
        }
      });
    }
  });

  it('keeps observed sets when five eligible prior sessions cannot supply a reference', () => {
    const points = projectCurveHistory(rows([...wave.prior, ...wave.scenarios.plateau])).points;
    const full = priorCurveReference(points, scope, start, 52);
    const sparse = points.filter(p => p.row.session !== full.selected[0].session);
    const insufficient = priorCurveReference(sparse, scope, start, 52);
    expect({ support: full.qualifyingSessions, rm: full.rm }).toEqual(oracle.referenceOracle.complete);
    expect({ support: insufficient.qualifyingSessions, rm: insufficient.rm }).toEqual(oracle.referenceOracle.insufficient);
    expect(sparse.filter(p => p.row.startedAt >= start)).toHaveLength(72);
  });
});
