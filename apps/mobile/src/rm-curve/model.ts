import { compareReadingIds } from '@/src/bodyweight/as-of';
import { requireDate } from '@/src/bodyweight/weight-entry';
import type { RmCurveGraph, RmCurveRow } from '@/src/data/rm-curve';
import { projectRmCurveSet, rmCurveKnots, rmCurveResidual, type RmCurveExclusion, type RmCurveValues } from '@/src/exercise-calculations/rm-curve';
import type { RegimeSession } from '@/src/strength-regimes/fit';
import { MAX_HISTORY_LOOKBACK_WEEKS } from '@/src/preferences/model';
import { calendarWeekBounds, historyWeekBounds } from '@/src/utils/calendar-weeks';

export type RmCurveRange = 'week' | 'progress' | 'history';
export type RmCurveEvaluation = {
  start: Date; end: Date; historyLookbackWeeks: number;
  /** Three-state (`src/utils/gym-scope-route.ts`): unset every gym, `null` no gym, an id that gym. */
  gymId?: string | null; rir?: number | null;
};
export type RmCurveObservation = RmCurveRow & RmCurveValues & {
  residual: ReturnType<typeof rmCurveResidual>;
};

function validateHistoryWeeks(weeks: number) {
  if (!Number.isSafeInteger(weeks) || weeks < 1 || weeks > MAX_HISTORY_LOOKBACK_WEEKS) throw new Error('Invalid History look-back');
}

/** [[1rm.curve-scope]]; the prior look-back is independently anchored to start. */
export function rmCurveWindow(historyLookbackWeeks: number, now = new Date(), range: RmCurveRange = 'history', progressWeeks = 1) {
  requireDate(now, 'now'); validateHistoryWeeks(historyLookbackWeeks);
  validateHistoryWeeks(progressWeeks);
  if (!['week', 'progress', 'history'].includes(range)) throw new Error('Invalid RM chart range');
  const historyStart = historyWeekBounds(historyLookbackWeeks, now).start;
  const start = range === 'history' ? historyStart : calendarWeekBounds(range === 'week' ? 1 : progressWeeks, now).start;
  requireDate(start, 'start');
  return { start, end: new Date(now), historyLookbackWeeks };
}

export function rmCurvePriorStart(scope: RmCurveEvaluation) {
  requireDate(scope.start, 'start'); requireDate(scope.end, 'end'); validateHistoryWeeks(scope.historyLookbackWeeks);
  if (scope.end <= scope.start) throw new Error('Invalid RM evaluation window');
  if (scope.rir != null && (!Number.isSafeInteger(scope.rir) || scope.rir < 0)) throw new Error('Invalid RIR filter');
  const start = historyWeekBounds(scope.historyLookbackWeeks, scope.start).start;
  requireDate(start, 'prior start');
  return start;
}

const validSessionTime = (row: RmCurveRow) => Number.isFinite(row.startedAt.getTime()) &&
  Number.isFinite(row.completedAt.getTime()) && row.startedAt <= row.completedAt;
const compareObservations = (a: RmCurveRow, b: RmCurveRow) =>
  b.completedAt.getTime() - a.completedAt.getTime() || compareReadingIds(a.sessionId, b.sessionId) ||
  a.blockOrder - b.blockOrder || a.setOrder - b.setOrder || compareReadingIds(a.setId, b.setId);

type ProjectedRow = { row: RmCurveRow; value: RmCurveValues | RmCurveExclusion };
function gymOptions(rows: ProjectedRow[]) {
  const latest = new Map<string | null, { gymId: string | null; name: string | null; completedAt: Date }>();
  for (const { row, value } of rows) {
    if (value === 'not_working') continue;
    const previous = latest.get(row.gymId);
    if (!previous || row.completedAt > previous.completedAt) latest.set(row.gymId,
      { gymId: row.gymId, name: row.gymName, completedAt: row.completedAt });
  }
  return [...latest.values()].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || compareReadingIds(a.gymId ?? '', b.gymId ?? ''));
}

function priorReference(points: (RmCurveRow & RmCurveValues)[], start: Date, lower: Date) {
  const sessions = new Map<string, { sessionId: string; completedAt: Date; bestTotalRm: number }>();
  for (const point of points) {
    if (point.completedAt < lower || point.completedAt >= start || point.equivalentReps > 10 || point.analyticalTotalRm <= 0) continue;
    const previous = sessions.get(point.sessionId);
    if (!previous || point.analyticalTotalRm > previous.bestTotalRm) sessions.set(point.sessionId,
      { sessionId: point.sessionId, completedAt: point.completedAt, bestTotalRm: point.analyticalTotalRm });
  }
  const ordered = [...sessions.values()].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || compareReadingIds(a.sessionId, b.sessionId));
  const selectedSessions = ordered.slice(0, 6);
  const bests = selectedSessions.map(row => row.bestTotalRm).sort((a, b) => a - b);
  const totalRm = bests.length === 6 ? bests[2] + (bests[3] - bests[2]) / 2 : null;
  return { totalRm, qualifyingSessions: ordered.length, selectedSessions, lowerBound: lower };
}

function projectRows(graph: RmCurveGraph, scope: RmCurveEvaluation): ProjectedRow[] {
  const lower = rmCurvePriorStart(scope);
  return graph.rows.filter(row => validSessionTime(row) && row.completedAt >= lower && row.completedAt < scope.end)
    .map(row => ({ row, value: projectRmCurveSet({ ...row.loadContext, ...row,
      performanceStatus: row.performanceStatus === null ? null : 'unperformed' }) }));
}

/** One graph supplies observations and reference; no evaluated/future set enters the reference. */
export function buildRmCurveModel(graph: RmCurveGraph, scope: RmCurveEvaluation) {
  const lower = rmCurvePriorStart(scope);
  const projected = projectRows(graph, scope);
  const gyms = gymOptions(projected);
  const gymId = scope.gymId;
  const cohort = gymId === undefined ? projected : projected.filter(({ row }) => row.gymId === gymId);
  const effortOptions = [...new Set(cohort.flatMap(({ value }) => typeof value === 'string' ? [] : [value.rir]))].sort((a, b) => a - b);
  const points = cohort.flatMap(({ row, value }) => typeof value === 'string' || (scope.rir != null && value.rir !== scope.rir)
    ? [] : [{ ...row, ...value }]);
  const reference = priorReference(points, scope.start, lower);
  const observations: RmCurveObservation[] = points.filter(point => point.completedAt >= scope.start).sort(compareObservations)
    .map(point => ({ ...point, residual: rmCurveResidual(point, reference.totalRm, graph.definition.loadInputMode) }));
  const excluded: Record<RmCurveExclusion, number> = { not_working: 0, missing_effort: 0, unknown_effort: 0, invalid_metrics: 0, equivalent_reps_overflow: 0 };
  for (const { row, value } of cohort) if (row.completedAt >= scope.start && typeof value === 'string') excluded[value] += 1;
  const maxReps = observations.reduce((max, row) => Math.max(max, row.equivalentReps), 20);
  return { definition: graph.definition, start: scope.start, end: scope.end, gymId, rir: scope.rir ?? null,
    gyms, effortOptions, reference, observations, excluded,
    inferenceSessions: inferenceSessions(observations),
    curve: rmCurveKnots(reference.totalRm, graph.definition.loadInputMode, maxReps) };
}

export type RmCurveModel = ReturnType<typeof buildRmCurveModel>;

/** [[1rm.curve-fitting]]; observations are filtered and in session order, so ties keep the first. */
function inferenceSessions(observations: RmCurveObservation[]): RegimeSession[] {
  const bests = new Map<string, RmCurveObservation>();
  for (const point of observations) {
    const previous = bests.get(point.sessionId);
    if (!previous || point.existingOneRepMax > previous.existingOneRepMax) bests.set(point.sessionId, point);
  }
  return [...bests.values()].map(point => ({ sessionId: point.sessionId, time: point.completedAt.getTime(),
    selectedSet: { setId: point.setId, reps: point.reps, rir: point.rir, load: point.calculatedLoadKg } }));
}
