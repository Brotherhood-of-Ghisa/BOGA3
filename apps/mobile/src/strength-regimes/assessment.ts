import { fitStrengthTrajectory, prepareRegimePoints, type fitStrengthRegimes } from './fit';
import type { RmCurveModel } from '@/src/rm-curve/model';
import { rmCurveKnots } from '@/src/exercise-calculations/rm-curve';

export type CurveMode = 'one' | 'two';
export type UncertaintyMethod = 'fixed' | 'joint';
export type RegimeCurve = { period: 'all' | 'older' | 'newer'; totalRm: number;
  knots: ReturnType<typeof rmCurveKnots>; opacity: number };
export type RegimeAssessment = { curves: RegimeCurve[]; boundary: number | null;
  sampledSessions: number; message: string; evidence: number | null; calibrationScope: 'unsupported';
  boundaryBracket: [number, number] | null; diagnostics: RegimeFit | null };
export type RegimeFit = ReturnType<typeof fitStrengthRegimes>;

export function usableFit(fit: RegimeFit['bestNoBreak']) {
  return fit !== null && fit.converged && !fit.rankDeficient && !fit.strengthBoundary && !fit.loadBoundary;
}

export function regimeCurve(model: RmCurveModel, totalRm: number, period: RegimeCurve['period']): RegimeCurve {
  const maxReps = model.observations.reduce((max, p) => Math.max(max, p.equivalentReps), 20);
  return { period, totalRm, knots: rmCurveKnots(totalRm, model.definition.loadInputMode, maxReps), opacity: 1 };
}

/** Unknown real-history mechanisms cannot certify membership of a simulated calibration family. */
export function assessRegimes(model: RmCurveModel, fit: RegimeFit): RegimeAssessment {
  const base = { sampledSessions: fit.sampledSessions, curves: [] as RegimeCurve[], boundary: null, evidence: fit.evidence, calibrationScope: 'unsupported' as const,
    boundaryBracket: null, diagnostics: fit };
  if (fit.status === 'insufficient') return { ...base, message: 'More sessions needed' };
  if (fit.status === 'unresolved' || !fit.candidate) return { ...base, message: 'Fit unavailable' };
  return { ...base, curves: [regimeCurve(model, fit.candidate.controls[0], 'older'), regimeCurve(model, fit.candidate.controls[1], 'newer')],
    boundary: fit.candidate.rightTime, boundaryBracket: [fit.candidate.leftTime, fit.candidate.rightTime], message: 'Exploratory fit' };
}

export function assessSingleCurve(model: RmCurveModel, method: UncertaintyMethod): RegimeAssessment {
  const points = prepareRegimePoints(model.inferenceSessions);
  const base = { sampledSessions: points.length, curves: [] as RegimeCurve[], boundary: null, evidence: null, calibrationScope: 'unsupported' as const,
    boundaryBracket: null, diagnostics: null };
  if (!points.length) return { ...base, message: 'More sessions needed' };
  const fit = fitStrengthTrajectory(points, 'constant', { method });
  return { ...base, message: usableFit(fit) ? 'Exploratory fit' : 'Fit unavailable',
    curves: usableFit(fit) ? [regimeCurve(model, fit.controls[0], 'all')] : [] };
}
