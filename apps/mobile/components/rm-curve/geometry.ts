import type { RegimeCurve } from '@/src/strength-regimes/assessment';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { formatOneRepMax } from '@/src/exercise-calculations/format';

export const PLOT_HEIGHT = 252;
const RIGHT = 24, TOP = 24, BOTTOM = 24;

export const axisLabel = (value: number) => Math.abs(value) >= 10000 ? value.toExponential(1) : String(Number(formatOneRepMax(value)));

/** Ratios before multiplication keep finite extreme inputs on the plot. */
export function curveGeometry(model: RmCurveModel, width: number, curves?: RegimeCurve[]) {
  const maxReps = model.observations.reduce((max, p) => Math.max(max, p.equivalentReps + (p.rir > 0 ? 1 : 0)), 20);
  const knots = curves === undefined ? model.curve : curves.flatMap(c => c.knots);
  const maxLoad = knots.reduce((max, p) => Math.max(max, p.loadKg),
    model.observations.reduce((max, p) => Math.max(max, p.loadKg), 1));
  const LEFT = maxLoad >= 10000 ? 56 : 38;
  const x = (reps: number) => LEFT + (reps / maxReps) * Math.max(1, width - LEFT - RIGHT);
  const y = (load: number) => TOP + (1 - load / maxLoad) * (PLOT_HEIGHT - TOP - BOTTOM);
  const duration = model.end.getTime() - model.start.getTime();
  const points = model.observations.map(p => ({
    id: p.setId, x: x(p.equivalentReps), y: y(p.loadKg),
    recency: Math.min(3, Math.max(0, Math.floor(4 * (p.completedAt.getTime() - model.start.getTime()) / duration))),
  }));
  const lines = (curves ?? []).map(curve => ({ ...curve, line: curve.knots.map(p => `${x(p.reps)},${y(p.loadKg)}`).join(' ') }));
  return { lines, maxReps, maxLoad, x, y, points, line: model.curve.map(p => `${x(p.reps)},${y(p.loadKg)}`).join(' ') };
}

/** Return candidates in the model's chronological order; never jitter a mark. */
export function pointsAt(geometry: ReturnType<typeof curveGeometry>, x: number, y: number, target: number) {
  return geometry.points.filter(p => Math.hypot(p.x - x, p.y - y) <= target / 2).map(p => p.id);
}
