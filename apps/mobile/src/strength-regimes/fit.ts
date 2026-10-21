// Direct conditional likelihood; convergence alone does not establish a strength change.
import { conditionalTrajectoryLikelihood, type JointRirPoint } from './likelihood';
import { fitRegression, median } from './regression';
import { rirCurveMultipliers } from './multipliers';
import { iterateBoundedSearch } from './bounded-search';

export type RegimeSession = { sessionId: string; time: number;
  selectedSet: { setId: string; reps: number; rir: number | null; load: number } | null };
export type RegimePoint = JointRirPoint & { sessionId: string; setId: string; time: number };
export type RegimeOptions = { method: 'fixed' | 'joint'; minimumSegment?: number;
  correctProbability?: number; loadSd?: number; loadSdBounds?: [number, number]; maxIterations?: number; maxPointEvaluations?: number };
export const FIXED_REGIME_UNCERTAINTY = { correctProbability: 0.5, loadSd: 2.5 } as const;
export type FitBudget = { remaining: number };
export class FitWorkLimitError extends Error {}
export type TrajectoryKind = 'constant' | 'linear' | 'quadratic' | 'step';
export type TrajectoryFit = { kind: TrajectoryKind; controls: number[]; fittedStrengths: number[];
  correctProbability: number | null; loadSd: number; logLikelihood: number; converged: boolean;
  rankDeficient: boolean; minimumStrength: number; strengthBoundary: boolean; loadBoundary: boolean; iterations: number; startScoreSpread: number };
export type CutFit = TrajectoryFit & { cutIndex: number; leftTime: number; rightTime: number };

export function prepareRegimePoints(sessions: RegimeSession[]): RegimePoint[] {
  const ids = new Set<string>(), sets = new Set<string>();
  return sessions.slice().sort((a, b) => a.time - b.time || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    .flatMap(session => {
      if (!session.sessionId || ids.has(session.sessionId) || !Number.isFinite(session.time)) throw new Error('invalid regime session');
      ids.add(session.sessionId);
      const s = session.selectedSet;
      if (s === null) return [];
      if (!s || !s.setId || sets.has(s.setId) || !Number.isFinite(s.load) || s.load < 0 ||
        !Number.isSafeInteger(s.reps) || s.reps < 1) throw new Error('invalid selected set');
      sets.add(s.setId);
      if (s.rir === null) return [];
      return [{ sessionId: session.sessionId, setId: s.setId, time: session.time, load: s.load,
        recordedRir: s.rir, multipliers: rirCurveMultipliers(s.reps, s.rir) }];
    });
}

function validateOptions(options: RegimeOptions) {
  const minimum = options.minimumSegment ?? 8, p = options.correctProbability ?? FIXED_REGIME_UNCERTAINTY.correctProbability,
    sd = options.loadSd ?? FIXED_REGIME_UNCERTAINTY.loadSd;
  const bounds = options.loadSdBounds ?? [0.5, 7.5];
  if (!['fixed', 'joint'].includes(options.method) || !Number.isSafeInteger(minimum) || minimum < 2 ||
    !Number.isFinite(p) || p < 0 || p > 1 || !Number.isFinite(sd) || sd <= 0 ||
    bounds.length !== 2 || !bounds.every(Number.isFinite) || bounds[0] <= 0 || bounds[0] >= bounds[1] ||
    (options.maxPointEvaluations !== undefined && (!Number.isSafeInteger(options.maxPointEvaluations) || options.maxPointEvaluations < 1)) ||
    (options.maxIterations !== undefined && (!Number.isSafeInteger(options.maxIterations) || options.maxIterations < 1)))
    throw new Error('invalid regime options');
  return { minimum, p, sd, bounds };
}

function trajectoryBasis(points: RegimePoint[], kind: TrajectoryKind, cut?: number) {
  const first = points[0].time, span = points[points.length - 1].time - first;
  return points.map((point, i) => {
    const t = span ? (point.time - first) / span : 0;
    if (kind === 'constant') return [1];
    if (kind === 'step') return i < cut! ? [1, 0] : [0, 1];
    return kind === 'linear' ? [1 - t, t] : [(1 - t) ** 2, 2 * t * (1 - t), t * t];
  });
}

function startingControls(points: RegimePoint[], kind: TrajectoryKind, scale: number, cut?: number) {
  const amplitudes = points.map(p => p.load * p.multipliers[Math.floor(p.multipliers.length / 2)] / scale);
  const positive = (x: number) => Math.max(0.001, x);
  const fallback = Array(kind === 'constant' ? 1 : kind === 'quadratic' ? 3 : 2).fill(positive(median(amplitudes)));
  if (kind === 'constant') return { values: fallback, rankDeficient: false };
  if (kind === 'step') return { values: [positive(median(amplitudes.slice(0, cut))), positive(median(amplitudes.slice(cut)))], rankDeficient: false };
  const first = points[0].time, span = points[points.length - 1].time - first;
  const rows = points.map((p, i) => ({ time: (p.time - first) / span, value: amplitudes[i] }));
  const fit = fitRegression(rows, kind);
  if (!fit) return { values: fallback, rankDeficient: true };
  const [a, b, c = 0] = fit.coefficients;
  return { values: kind === 'linear' ? [positive(a), positive(a + b)] : [positive(a), a + b / 2, positive(a + b + c)], rankDeficient: false };
}

function minimumControl(x: number[], kind: TrajectoryKind, count: number) {
  if (kind !== 'quadratic') return Math.min(...x.slice(0, count));
  const [a, b, c] = x, vertex = (a - b) / (a - 2 * b + c);
  return Math.min(a, c, vertex > 0 && vertex < 1
    ? (1 - vertex) ** 2 * a + 2 * vertex * (1 - vertex) * b + vertex ** 2 * c : Infinity);
}

export function* iterateStrengthTrajectory(points: RegimePoint[], kind: TrajectoryKind, options: RegimeOptions,
  cut?: number, budget: FitBudget = { remaining: options.maxPointEvaluations ?? Infinity }): Generator<void, TrajectoryFit> {
  const checked = validateOptions(options);
  if (!points.length || points.some((p, i) => !Number.isFinite(p.time) || (i > 0 && p.time < points[i - 1].time)) ||
    !['constant', 'linear', 'quadratic', 'step'].includes(kind) ||
    (kind === 'linear' && points.length <= 2) || (kind === 'quadratic' && points.length <= 3) ||
    ((kind === 'linear' || kind === 'quadratic') && new Set(points.map(p => p.time)).size < (kind === 'linear' ? 2 : 3)) ||
    (kind === 'step' && (!Number.isSafeInteger(cut) || cut! < 1 || cut! >= points.length))) throw new Error('invalid trajectory design');
  const likelihood = conditionalTrajectoryLikelihood(points), basis = trajectoryBasis(points, kind, cut);
  const amplitudes = points.flatMap(p => p.multipliers.map(f => p.load * f));
  if (amplitudes.some(a => !Number.isFinite(a))) throw new Error('nonfinite implied strength');
  const scale = Math.max(1, median(amplitudes)), ceiling = Math.max(4, 4 * (Math.max(...amplitudes) / scale));
  if (!Number.isFinite(ceiling)) throw new Error('nonfinite strength search bounds');
  const count = basis[0].length, joint = options.method === 'joint';
  const informed = points.some(p => p.multipliers.some(f => Math.abs(f - p.multipliers[0]) > 1e-14));
  const freeP = joint && informed;
  const bounds: [number, number][] = Array.from({ length: count }, (_, i) =>
    [kind === 'quadratic' && i === 1 ? -ceiling : 1e-7, ceiling]);
  if (freeP) bounds.push([0, 1]);
  if (joint) bounds.push([Math.log(checked.bounds[0]), Math.log(checked.bounds[1])]);
  const decode = (x: number[]) => ({ strengths: basis.map(row => scale * row.reduce((s, w, i) => s + w * x[i], 0)),
    p: freeP ? x[count] : checked.p, sd: joint ? Math.exp(x[x.length - 1]) : checked.sd });
  const objective = (x: number[]) => {
    if (budget.remaining < points.length) throw new FitWorkLimitError('interactive fit work limit');
    budget.remaining -= points.length;
    const decoded = decode(x);
    if (decoded.strengths.some(s => !Number.isFinite(s) || s <= 0)) return Infinity;
    if (minimumControl(x, kind, count) <= 0) return Infinity;
    return -likelihood(decoded.strengths, decoded.p, decoded.sd);
  };
  const initial = startingControls(points, kind, scale, cut);
  const starts = [];
  const factors = [0.95, 1, 1.05], yieldEvery = Math.max(1, Math.floor(1024 / points.length));
  for (const [i, factor] of factors.entries()) {
    const x = i === 1 ? Array(count).fill(Math.max(0.001, median(amplitudes) / scale)) : initial.values.map(v => v * factor);
    if (freeP) x.push([0.15, 0.5, 0.85][i]);
    if (joint) x.push(Math.log(Math.max(checked.bounds[0], Math.min(checked.bounds[1], checked.sd))));
    starts.push(yield* iterateBoundedSearch(objective, x, bounds, options.maxIterations ?? 450, yieldEvery));
  }
  starts.sort((a, b) => a.value - b.value);
  const refined = yield* iterateBoundedSearch(objective, starts[0].x, bounds, options.maxIterations ?? 450, yieldEvery);
  const best = refined.value <= starts[0].value ? refined : starts[0], decoded = decode(best.x);
  return { kind, controls: best.x.slice(0, count).map(s => s * scale), fittedStrengths: decoded.strengths,
    correctProbability: informed ? decoded.p : null, loadSd: decoded.sd, logLikelihood: -best.value,
    converged: !initial.rankDeficient && best.converged && refined.converged && Number.isFinite(best.value),
    rankDeficient: initial.rankDeficient, minimumStrength: scale * minimumControl(best.x, kind, count),
    strengthBoundary: minimumControl(best.x, kind, count) <= 1e-6 || best.x.slice(0, count).some((s, i) => Math.min(s - bounds[i][0], bounds[i][1] - s) < 1e-5),
    loadBoundary: joint && Math.min(Math.abs(decoded.sd - checked.bounds[0]), Math.abs(decoded.sd - checked.bounds[1])) < 1e-4,
    iterations: starts.reduce((s, r) => s + r.iterations, refined.iterations),
    startScoreSpread: starts[starts.length - 1].value - starts[0].value };
}

export function* iterateStrengthRegimes(sessions: RegimeSession[], options: RegimeOptions) {
  const { minimum } = validateOptions(options), points = prepareRegimePoints(sessions);
  const distinct = new Set(points.map(p => p.time)).size;
  const kinds: TrajectoryKind[] = distinct >= 3 && points.length > 3 ? ['constant', 'linear', 'quadratic']
    : distinct >= 2 && points.length > 2 ? ['constant', 'linear'] : ['constant'];
  const budget = { remaining: options.maxPointEvaluations ?? Infinity };
  const noBreakFits: TrajectoryFit[] = [];
  for (const kind of points.length ? kinds : []) {
    noBreakFits.push(yield* iterateStrengthTrajectory(points, kind, options, undefined, budget));
    yield;
  }
  const bestNoBreak = noBreakFits.slice().sort((a, b) => b.logLikelihood - a.logLikelihood)[0] ?? null;
  const cuts: CutFit[] = [];
  for (let cut = minimum; cut <= points.length - minimum; cut++) {
    if (points[cut - 1].time === points[cut].time) continue;
    cuts.push({ ...yield* iterateStrengthTrajectory(points, 'step', options, cut, budget), cutIndex: cut,
      leftTime: points[cut - 1].time, rightTime: points[cut].time });
    yield;
  }
  const candidate = cuts.slice().sort((a, b) => b.logLikelihood - a.logLikelihood)[0] ?? null;
  const gain = candidate && bestNoBreak ? 2 * (candidate.logLikelihood - bestNoBreak.logLikelihood) : NaN;
  const unresolved = [...noBreakFits, ...cuts].some(f => !f.converged || f.strengthBoundary || f.loadBoundary);
  return { status: !candidate ? 'insufficient' as const : unresolved ? 'unresolved' as const : 'fitted' as const,
    method: options.method, inputSessions: sessions.length, sampledSessions: points.length, omittedSessions: sessions.length - points.length,
    points, noBreakFits, bestNoBreak, candidate, cutProfile: cuts,
    evidence: Number.isFinite(gain) ? Math.max(0, gain) : null,
    limit: 'Numerical optimization/profile only; calibration and uncertainty require a matching assessment context.' };
}

/** Synchronous research callers drain the same resumable numerical operations. */
export function fitStrengthTrajectory(points: RegimePoint[], kind: TrajectoryKind, options: RegimeOptions, cut?: number): TrajectoryFit {
  const fit = iterateStrengthTrajectory(points, kind, options, cut);
  let next = fit.next();
  while (!next.done) next = fit.next();
  return next.value;
}

/** Without an explicit budget, research retains the exhaustive search. */
export function fitStrengthRegimes(sessions: RegimeSession[], options: RegimeOptions) {
  const fits = iterateStrengthRegimes(sessions, options);
  let next = fits.next();
  while (!next.done) next = fits.next();
  return next.value;
}
