// Research-only profile grids and searched regression diagnostics.
import { fitRegression, jointLikelihoodGrid, scanBreaks, type BreakFit, type JointRirPoint, type ResearchRow } from './residual-regression-research';
import type { LoadInputMode } from '../../src/exercise-calculations/load-metrics';

export const DEFAULT_ENTRY_LOAD_SD_KG: Record<LoadInputMode, number> = { per_side_load: 1.25, total_load: 2.5 };

export function jointUncertaintyProfiles(points: JointRirPoint[], strengths: number[], rirSds: number[], loadSds: number[]) {
  if (!loadSds.length) throw new Error('nonempty load uncertainty axis required');
  const cube = loadSds.map(sd => jointLikelihoodGrid(points, strengths, rirSds, sd));
  return { cube,
    strengthProfile: strengths.map((_, i) => Math.max(...cube.flatMap(grid => grid.map(row => row[i])))),
    sigmaProfile: rirSds.map((_, i) => Math.max(...cube.flatMap(grid => grid[i]))),
    loadProfile: cube.map(grid => Math.max(...grid.flat())) };
}

export type ProfileComponent = { lower: number | null; upper: number | null };
export type ProfileResult = { estimate: number; maximum: number; components: ProfileComponent[];
  lowerBoundary: boolean; upperBoundary: boolean };

export function profileSet(axis: number[], scores: number[], cutoff: number): ProfileResult | null {
  if (!axis.length || axis.length !== scores.length || !Number.isFinite(cutoff) || cutoff < 0 ||
    axis.some((x, i) => !Number.isFinite(x) || (i > 0 && x <= axis[i - 1])) ||
    scores.some(x => Number.isNaN(x) || x === Infinity)) throw new Error('invalid profile');
  const maximum = Math.max(...scores);
  if (maximum === -Infinity) return null;
  const threshold = maximum - cutoff / 2, components: ProfileComponent[] = [];
  const crossing = (left: number, right: number) => {
    if (!Number.isFinite(scores[left])) return axis[right];
    if (!Number.isFinite(scores[right])) return axis[left];
    return axis[left] + (axis[right] - axis[left]) * (threshold - scores[left]) / (scores[right] - scores[left]);
  };
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < threshold) continue;
    const start = i;
    while (i + 1 < scores.length && scores[i + 1] >= threshold) i++;
    components.push({ lower: start === 0 ? null : crossing(start - 1, start),
      upper: i === scores.length - 1 ? null : crossing(i, i + 1) });
  }
  const best = scores.indexOf(maximum);
  return { estimate: axis[best], maximum, components, lowerBoundary: best === 0,
    upperBoundary: best === axis.length - 1 };
}

export function profileContains(profile: ProfileResult | null, truth: number): boolean {
  return !!profile?.components.some(c => (c.lower === null || truth >= c.lower) &&
    (c.upper === null || truth <= c.upper));
}

export function upperQuantile(values: number[], probability: number): number {
  if (!values.length || values.some(x => !Number.isFinite(x)) || !(probability > 0 && probability < 1))
    throw new Error('finite nonempty quantile required');
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length + 1) * probability) - 1)];
}

export function searchedBreak(rows: ResearchRow[], minimumSegment = 8): { statistic: number; fit: BreakFit } | null {
  const smooth = fitRegression(rows, 'quadratic');
  const candidates = scanBreaks(rows, minimumSegment).sort((a, b) => a.rss - b.rss);
  if (!smooth || smooth.rss <= 1e-12 || !candidates.length) return null;
  return { statistic: Math.max(0, (smooth.rss - candidates[0].rss) / (smooth.rss / rows.length)), fit: candidates[0] };
}

export function prefixBreakMaximum(rows: ResearchRow[], prefixes: number[], minimumSegment = 8): number | null {
  if (!prefixes.length || prefixes.some(n => !Number.isSafeInteger(n) || n < 1 || n > rows.length))
    throw new Error('invalid prefix family');
  const scans = prefixes.map(n => searchedBreak(rows.slice(0, n), minimumSegment)).filter(s => s !== null);
  return scans.length ? Math.max(...scans.map(s => s.statistic)) : null;
}
