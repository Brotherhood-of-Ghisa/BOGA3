// Research/test-only calculations. No runtime consumer or inferential guarantee.
import { median, fitRegression, regressionDesign as design, regressionDot as dot } from '../../src/strength-regimes/regression';
import { conditionalRirProbability, latentRirStates } from '../../src/strength-regimes/likelihood';
export { median, fitRegression } from '../../src/strength-regimes/regression';
export * from '../../src/strength-regimes/likelihood';
export const RIR_REPORTING_MODEL = 'exact-zero-conditional-three-point.v1';
export type ResearchRow = { time: number; value: number; covariates?: number[] };
export type ResearchModel = 'constant' | 'linear' | 'quadratic' | 'hinge' | 'jump';
export type ResearchFit = {
  model: ResearchModel; breakAt?: number; coefficients: number[];
  fitted: number[]; residuals: number[]; rss: number; n: number;
};
export type BreakFit = ResearchFit & { leftTime: number; rightTime: number };

export function sessionMedians(points: { session: string; time: number; value: number }[]): ResearchRow[] {
  const grouped = new Map<string, { time: number; values: number[] }>();
  for (const point of points) {
    if (!point.session || !Number.isFinite(point.time) || !Number.isFinite(point.value)) throw new Error('invalid session point');
    const group = grouped.get(point.session) ?? { time: point.time, values: [] };
    if (group.time !== point.time) throw new Error('session times disagree');
    group.values.push(point.value);
    grouped.set(point.session, group);
  }
  return [...grouped.values()].map(group => ({ time: group.time, value: median(group.values) }))
    .sort((a, b) => a.time - b.time);
}

export function predict(fit: ResearchFit, row: ResearchRow): number {
  return dot(design(row, fit.model, fit.breakAt), fit.coefficients);
}

export function scanBreaks(rows: ResearchRow[], minimumSegment: number): BreakFit[] {
  if (!Number.isSafeInteger(minimumSegment) || minimumSegment < 2) throw new Error('minimum segment must be >=2');
  const ordered = rows.slice().sort((a, b) => a.time - b.time), fits: BreakFit[] = [];
  for (let cut = minimumSegment; cut <= ordered.length - minimumSegment; cut++) {
    const leftTime = ordered[cut - 1].time, rightTime = ordered[cut].time;
    if (!(leftTime < rightTime)) continue;
    const breakAt = leftTime + (rightTime - leftTime) / 2;
    for (const model of ['hinge', 'jump'] as const) {
      const fit = fitRegression(ordered, model, breakAt);
      if (fit) fits.push({ ...fit, leftTime, rightTime });
    }
  }
  return fits;
}

export function researchBic(fit: ResearchFit): number | null {
  // shortcut: ordinary BIC is a ranking sensitivity, replace after search-specific validation.
  if (fit.rss <= 1e-12) return null;
  const parameters = fit.coefficients.length + 1 + Number(fit.breakAt !== undefined);
  return fit.n * Math.log(fit.rss / fit.n) + parameters * Math.log(fit.n);
}

export function seededRandom(seed: number): { uniform: () => number; normal: () => number } {
  if (!Number.isSafeInteger(seed)) throw new Error('integer seed required');
  let state = seed >>> 0;
  const uniform = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return { uniform, normal: () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()) };
}
