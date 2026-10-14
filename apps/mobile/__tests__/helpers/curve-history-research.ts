// Test/research-only extraction; production readers do not import this module.
import { estimateOneRepMax } from '../../src/exercise-calculations/index.ts';
import { calculateSetMetrics, type LoadInputMode } from '../../src/exercise-calculations/load-metrics.ts';
import { DEFAULT_PERSONAL_EFFORT_POLICY, getSessionSetRir,
  type EffortCalculationPolicy } from '../../src/exercise-calculations/effort-policy.ts';
import { isWorkingSet, type SessionSetPerformanceStatus } from '../../src/exercise-calculations/set-semantics.ts';
import { compareReadingIds } from '../../src/bodyweight/as-of.ts';
import { historyWeekBounds } from '../../src/utils/calendar-weeks.ts';
import { median } from './residual-regression-research.ts';

export type CurveHistoryRow = {
  owner: string; exercise: string | null; gym: string | null; session: string; block: string; id: string;
  startedAt: number; completedAt: number | null; status: string; deleted: boolean;
  weightValue: string; repsValue: string; setType: string | null;
  performanceStatus: SessionSetPerformanceStatus; loadInputMode: LoadInputMode;
  bodyweightContribution: number; bodyweightEnabled: boolean; bodyWeightKg: number | null;
};
export type CurvePoint = {
  row: CurveHistoryRow; reps: number; rir: number; equivalentReps: number;
  load: number; factor: number; analyticalRm: number; existingRm: number | null;
};
export type CurveScope = Pick<CurveHistoryRow, 'owner' | 'exercise' | 'gym'>;
export const curveScopeKey = (row: CurveScope): string => JSON.stringify([row.owner, row.exercise, row.gym]);

export function projectCurveHistory(rows: CurveHistoryRow[], policy: EffortCalculationPolicy = DEFAULT_PERSONAL_EFFORT_POLICY) {
  const points: CurvePoint[] = [], excluded: Record<string, number> = {}, seen = new Set<string>();
  const omit = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  for (const row of rows) {
    const identity = JSON.stringify([row.owner, row.id]);
    if (seen.has(identity)) throw new Error('duplicate set identity in extraction');
    seen.add(identity);
    if (!row.owner || !row.session || !row.block || !row.id) throw new Error('missing graph identity');
    if (row.deleted) { omit('deleted_graph'); continue; }
    if (row.status !== 'completed' || row.completedAt === null) { omit('not_completed'); continue; }
    if (![row.startedAt, row.completedAt].every(Number.isSafeInteger) || row.completedAt < row.startedAt ||
        Math.abs(row.completedAt) > 8640000000000000 || Math.abs(row.startedAt) > 8640000000000000) {
      omit('invalid_session_time'); continue;
    }
    if (row.exercise === null) { omit('unlinked_exercise'); continue; }
    if (!isWorkingSet({ weight: row.weightValue, reps: row.repsValue, setType: row.setType,
      performanceStatus: row.performanceStatus }, policy)) { omit('not_performed_working'); continue; }
    const rir = getSessionSetRir(row.setType);
    if (rir === null) { omit(row.setType === null ? 'missing_effort' : 'unknown_effort'); continue; }
    const metrics = calculateSetMetrics({ ...row, policy: row.bodyweightEnabled ? 'personal' : 'ordinary' });
    if (!metrics.eligible || metrics.load.status !== 'known') { omit('uncalculable'); continue; }
    const equivalentReps = metrics.reps + rir;
    if (!Number.isSafeInteger(equivalentReps)) { omit('equivalent_reps_overflow'); continue; }
    const analyticalRm = estimateOneRepMax(metrics.load.calculatedLoadKg, equivalentReps);
    if (analyticalRm === null || !Number.isFinite(analyticalRm)) { omit('analytical_rm_invalid'); continue; }
    points.push({ row, reps: metrics.reps, rir, equivalentReps, load: metrics.load.calculatedLoadKg,
      factor: row.loadInputMode === 'per_side_load' ? 2 : 1, analyticalRm, existingRm: metrics.estimatedOneRepMaxKg });
  }
  return { points, excluded };
}

export function priorCurveReference(points: CurvePoint[], scope: CurveScope, start: number, lookbackWeeks: number) {
  if (!Number.isSafeInteger(start) || Math.abs(start) > 8640000000000000 ||
      !Number.isSafeInteger(lookbackWeeks) || lookbackWeeks < 1) throw new Error('invalid reference window');
  const lowerBound = historyWeekBounds(lookbackWeeks, new Date(start)).start.getTime();
  const key = curveScopeKey(scope), sessions = new Map<string, { session: string; completedAt: number; best: number }>();
  const evaluatedSessions = new Set(points.filter(p => curveScopeKey(p.row) === key && p.row.startedAt >= start)
    .map(p => p.row.session));
  for (const p of points) {
    if (curveScopeKey(p.row) !== key || p.equivalentReps > 10 || p.analyticalRm <= 0 ||
        p.row.completedAt! < lowerBound || p.row.completedAt! >= start || evaluatedSessions.has(p.row.session)) continue;
    const previous = sessions.get(p.row.session);
    if (previous && previous.completedAt !== p.row.completedAt) throw new Error('contradictory session completion');
    sessions.set(p.row.session, { session: p.row.session, completedAt: p.row.completedAt!,
      best: Math.max(p.analyticalRm, previous?.best ?? 0) });
  }
  const ordered = [...sessions.values()].sort((a, b) => b.completedAt - a.completedAt || compareReadingIds(a.session, b.session));
  const selected = ordered.slice(0, 6);
  return { lowerBound, start, qualifyingSessions: ordered.length, selected,
    rm: selected.length === 6 ? median(selected.map(row => row.best)) : null };
}

export function curveResidual(point: CurvePoint, referenceRm: number | null) {
  if (referenceRm === null) return null;
  if (!Number.isFinite(referenceRm) || referenceRm <= 0) throw new Error('invalid positive reference');
  const predictedLoad = referenceRm / estimateOneRepMax(1, point.equivalentReps)!;
  const signedKg = point.load - predictedLoad, percentage = 100 * (point.analyticalRm / referenceRm - 1);
  return [predictedLoad, signedKg, percentage].every(Number.isFinite) && predictedLoad > 0
    ? { predictedLoad, signedKg, percentage } : null;
}
