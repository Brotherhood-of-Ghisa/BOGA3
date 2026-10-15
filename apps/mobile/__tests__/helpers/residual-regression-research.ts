// Research/test-only calculations. No runtime consumer or inferential guarantee.
export const RIR_REPORTING_MODEL = 'exact-zero-positive-censored-gaussian.v1';
export type ResearchRow = { time: number; value: number; covariates?: number[] };
export type ResearchModel = 'constant' | 'linear' | 'quadratic' | 'hinge' | 'jump';
export type ResearchFit = {
  model: ResearchModel; breakAt?: number; coefficients: number[];
  fitted: number[]; residuals: number[]; rss: number; n: number;
};
export type BreakFit = ResearchFit & { leftTime: number; rightTime: number };

export function median(values: number[]): number {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('finite nonempty sample required');
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] / 2 + sorted[Math.floor(sorted.length / 2)] / 2;
}

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

function design(row: ResearchRow, model: ResearchModel, breakAt?: number): number[] {
  const columns = model === 'constant' ? [1] : [1, row.time];
  if (model === 'quadratic') columns.push(row.time * row.time);
  if (model === 'hinge') columns.push(Math.max(0, row.time - breakAt!));
  if (model === 'jump') columns.push(Number(row.time > breakAt!));
  return [...columns, ...(row.covariates ?? [])];
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function fitRegression(rows: ResearchRow[], model: ResearchModel, breakAt?: number): ResearchFit | null {
  if ((model === 'hinge' || model === 'jump') && !Number.isFinite(breakAt)) return null;
  const matrix = rows.map(row => design(row, model, breakAt));
  const p = matrix[0]?.length ?? 0;
  if (!p || rows.length <= p || matrix.some((row, i) => row.length !== p ||
    row.some(value => !Number.isFinite(value)) || !Number.isFinite(rows[i].time) || !Number.isFinite(rows[i].value))) return null;
  const q: number[][] = [], r = Array.from({ length: p }, () => Array<number>(p).fill(0));
  const scales = Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) {
    const raw = matrix.map(row => row[j]);
    scales[j] = Math.hypot(...raw);
    if (!Number.isFinite(scales[j]) || scales[j] === 0) return null;
    const column = raw.map(value => value / scales[j]);
    // Reorthogonalize scaled columns; reject dependence instead of inverting X'X.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < j; k++) {
        const projection = dot(q[k], column);
        r[k][j] += projection;
        for (let i = 0; i < column.length; i++) column[i] -= projection * q[k][i];
      }
    }
    r[j][j] = Math.hypot(...column);
    if (r[j][j] <= 1e-10) return null;
    q.push(column.map(value => value / r[j][j]));
  }
  const value = rows.map(row => row.value), scaled = q.map(column => dot(column, value));
  for (let j = p - 1; j >= 0; j--) {
    for (let k = j + 1; k < p; k++) scaled[j] -= r[j][k] * scaled[k];
    scaled[j] /= r[j][j];
  }
  const coefficients = scaled.map((coefficient, j) => coefficient / scales[j]);
  const fitted = matrix.map(row => dot(row, coefficients));
  const residuals = value.map((observed, i) => observed - fitted[i]);
  const rss = dot(residuals, residuals);
  if (![...coefficients, ...fitted, rss].every(Number.isFinite)) return null;
  return { model, breakAt, coefficients, fitted, residuals, rss, n: rows.length };
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

export function recordedRirFromLatent(latentRir: number, sd: number, standardNormalDraw: number): number {
  if (!Number.isSafeInteger(latentRir) || latentRir < 0 || !Number.isFinite(sd) || sd < 0 ||
    !Number.isFinite(standardNormalDraw)) throw new Error('invalid forward RIR model');
  if (latentRir === 0) return 0;
  // Positive readings accumulate the lower Gaussian tail at one, never at exact failure.
  const recorded = Math.max(1, Math.round(latentRir + sd * standardNormalDraw));
  if (!Number.isSafeInteger(recorded)) throw new Error('RIR overflow');
  return recorded;
}

function normalAreaFromZero(x: number): number {
  const h = x / 128;
  let sum = 1 + Math.exp(-x * x / 2);
  for (let i = 1; i < 128; i++) sum += (i % 2 ? 4 : 2) * Math.exp(-((i * h) ** 2) / 2);
  return h * sum / (3 * Math.sqrt(2 * Math.PI));
}

function normalLogSurvival(x: number): number {
  if (Number.isNaN(x)) throw new Error('invalid normal coordinate');
  if (x < 0) return Math.log1p(-Math.exp(normalLogSurvival(-x)));
  if (x < 2) return Math.log(0.5 - normalAreaFromZero(x));
  // Gaussian tail continued fraction (NIST DLMF 7.9); retain its log before underflow.
  let fraction = 0;
  for (let k = 64; k >= 1; k--) fraction = k / (x + fraction);
  return -x * x / 2 - Math.log(2 * Math.PI) / 2 - Math.log(x + fraction);
}

export function normalCdf(x: number): number {
  return x <= 0 ? Math.exp(normalLogSurvival(-x)) : -Math.expm1(normalLogSurvival(x));
}

export function recordedRirLogProbability(recorded: number, latent: number, sd: number): number {
  if (![recorded, latent].every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isFinite(sd) || sd < 0)
    throw new Error('invalid RIR probability');
  if (recorded === 0 || latent === 0 || sd === 0) return recorded === latent ? 0 : -Infinity;
  if (recorded === 1) return normalLogSurvival((latent - 1.5) / sd);
  let lower = (recorded - 0.5 - latent) / sd, upper = (recorded + 0.5 - latent) / sd;
  if (lower < 0 && upper > 0) return upper < 2 ? Math.log(2 * normalAreaFromZero(upper))
    : Math.log1p(-2 * Math.exp(normalLogSurvival(upper)));
  if (upper <= 0) [lower, upper] = [-upper, -lower];
  const logLowerTail = normalLogSurvival(lower), logUpperTail = normalLogSurvival(upper);
  return logLowerTail + Math.log(-Math.expm1(logUpperTail - logLowerTail));
}

export function recordedRirProbability(recorded: number, latent: number, sd: number): number {
  return Math.exp(recordedRirLogProbability(recorded, latent, sd));
}

export type JointRirPoint = { load: number; recordedRir: number; multipliers: number[] };

function loadLogNormalizer(predicted: number, sd: number): number {
  return -Math.log(sd * Math.sqrt(2 * Math.PI)) - Math.log(normalCdf(predicted / sd));
}

function loadLogDensity(load: number, predicted: number, sd: number): number {
  return loadLogNormalizer(predicted, sd) - (load - predicted) ** 2 / (2 * sd * sd);
}

function logMixture(terms: number[]): number {
  const maximum = Math.max(...terms);
  return maximum === -Infinity ? -Infinity : maximum +
    Math.log(terms.reduce((sum, term) => sum + Math.exp(term - maximum), 0));
}

export function jointLogLikelihood(points: JointRirPoint[], strength: number, rirSd: number, loadSd: number): number {
  if (!points.length || !Number.isFinite(strength) || strength <= 0 || !Number.isFinite(rirSd) || rirSd < 0 ||
    !Number.isFinite(loadSd) || loadSd <= 0) throw new Error('invalid joint model');
  let likelihood = 0;
  for (const point of points) {
    if (!Number.isFinite(point.load) || point.load < 0 || !point.multipliers.length ||
      point.multipliers.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('invalid joint point');
    const terms = point.multipliers.map((multiplier, latent) => {
      const logProbability = recordedRirLogProbability(point.recordedRir, latent, rirSd);
      if (logProbability === -Infinity) return -Infinity;
      const predicted = strength / multiplier;
      return logProbability - Math.log(point.multipliers.length) + loadLogDensity(point.load, predicted, loadSd);
    });
    likelihood += logMixture(terms);
  }
  return likelihood;
}

// Factor the same likelihood for repeated simulations; axes are [sigma][strength].
export function jointLikelihoodGrid(points: JointRirPoint[], strengths: number[], sds: number[], loadSd: number): number[][] {
  if (!strengths.length || !sds.length || strengths.some(s => !Number.isFinite(s) || s <= 0) ||
    sds.some(s => !Number.isFinite(s) || s < 0)) throw new Error('invalid likelihood grid');
  jointLogLikelihood(points, strengths[0], sds[0], loadSd);
  const probabilities = sds.map(sd => {
    const cache = new Map<string, number[]>();
    return points.map(p => {
      const key = `${p.recordedRir}:${p.multipliers.length}`;
      if (!cache.has(key)) cache.set(key, p.multipliers.map((_, r) =>
        recordedRirLogProbability(p.recordedRir, r, sd) - Math.log(p.multipliers.length)));
      return cache.get(key)!;
    });
  });
  const multipliers = [...new Set(points.flatMap(p => p.multipliers))];
  const loads = strengths.map(s => {
    const normalizers = new Map(multipliers.map(f => [f, loadLogNormalizer(s / f, loadSd)]));
    return points.map(p => p.multipliers.map(f => normalizers.get(f)! - (p.load - s / f) ** 2 / (2 * loadSd * loadSd)));
  });
  return probabilities.map(ps => loads.map(ls => ps.reduce((sum, terms, i) =>
    sum + logMixture(terms.map((term, r) => term + ls[i][r])), 0)));
}
