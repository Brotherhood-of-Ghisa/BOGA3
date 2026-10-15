export type ResearchRow = { time: number; value: number; covariates?: number[] };
export type ResearchModel = 'constant' | 'linear' | 'quadratic' | 'hinge' | 'jump';
export type ResearchFit = {
  model: ResearchModel; breakAt?: number; coefficients: number[];
  fitted: number[]; residuals: number[]; rss: number; n: number;
};
export function median(values: number[]): number {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('finite nonempty sample required');
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] / 2 + sorted[Math.floor(sorted.length / 2)] / 2;
}


export function regressionDesign(row: ResearchRow, model: ResearchModel, breakAt?: number): number[] {
  const columns = model === 'constant' ? [1] : [1, row.time];
  if (model === 'quadratic') columns.push(row.time * row.time);
  if (model === 'hinge') columns.push(Math.max(0, row.time - breakAt!));
  if (model === 'jump') columns.push(Number(row.time > breakAt!));
  return [...columns, ...(row.covariates ?? [])];
}

export const regressionDot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function fitRegression(rows: ResearchRow[], model: ResearchModel, breakAt?: number): ResearchFit | null {
  if ((model === 'hinge' || model === 'jump') && !Number.isFinite(breakAt)) return null;
  const matrix = rows.map(row => regressionDesign(row, model, breakAt));
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
        const projection = regressionDot(q[k], column);
        r[k][j] += projection;
        for (let i = 0; i < column.length; i++) column[i] -= projection * q[k][i];
      }
    }
    r[j][j] = Math.hypot(...column);
    if (r[j][j] <= 1e-10) return null;
    q.push(column.map(value => value / r[j][j]));
  }
  const value = rows.map(row => row.value), scaled = q.map(column => regressionDot(column, value));
  for (let j = p - 1; j >= 0; j--) {
    for (let k = j + 1; k < p; k++) scaled[j] -= r[j][k] * scaled[k];
    scaled[j] /= r[j][j];
  }
  const coefficients = scaled.map((coefficient, j) => coefficient / scales[j]);
  const fitted = matrix.map(row => regressionDot(row, coefficients));
  const residuals = value.map((observed, i) => observed - fitted[i]);
  const rss = regressionDot(residuals, residuals);
  if (![...coefficients, ...fitted, rss].every(Number.isFinite)) return null;
  return { model, breakAt, coefficients, fitted, residuals, rss, n: rows.length };
}
