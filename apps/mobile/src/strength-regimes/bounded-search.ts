// Bounded multistart simplex; convergence is numerical, not evidence of a global maximum.
export type SearchResult = { x: number[]; value: number; converged: boolean; iterations: number };
export function* iterateBoundedSearch(objective: (x: number[]) => number, start: number[],
  bounds: [number, number][], maxIterations = 300, yieldEvery = 32): Generator<void, SearchResult> {
  validateSearch(start, bounds, maxIterations, yieldEvery);
  const project = (x: number[]) => x.map((v, i) => Math.max(bounds[i][0], Math.min(bounds[i][1], v)));
  const vertex = (x: number[]) => { const at = project(x), value = objective(at);
    return { x: at, value: Number.isFinite(value) ? value : Infinity }; };
  const simplex = [vertex(start), ...start.map((_, i) => {
    const x = project(start), step = (bounds[i][1] - bounds[i][0]) * 0.035;
    x[i] += x[i] + step <= bounds[i][1] ? step : -step;
    return vertex(x);
  })];
  const n = start.length;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (iteration % yieldEvery === 0) yield;
    simplex.sort((a, b) => a.value - b.value);
    const best = simplex[0], worst = simplex[n];
    if (searchConverged(simplex))
      return { ...best, converged: true, iterations: iteration };
    const center = start.map((_, j) => simplex.slice(0, n).reduce((s, v) => s + v.x[j], 0) / n);
    const reflected = vertex(center.map((v, j) => v + (v - worst.x[j])));
    if (reflected.value < best.value) {
      const expanded = vertex(center.map((v, j) => v + 2 * (reflected.x[j] - v)));
      simplex[n] = expanded.value < reflected.value ? expanded : reflected;
    } else if (reflected.value < simplex[n - 1].value) simplex[n] = reflected;
    else {
      const outside = reflected.value < worst.value;
      const target = outside ? reflected : worst;
      const contracted = vertex(center.map((v, j) => v + 0.5 * (target.x[j] - v)));
      if (contracted.value < target.value) simplex[n] = contracted;
      else for (let i = 1; i <= n; i++) simplex[i] = vertex(best.x.map((v, j) => v + 0.5 * (simplex[i].x[j] - v)));
    }
  }
  simplex.sort((a, b) => a.value - b.value);
  return { ...simplex[0], converged: false, iterations: maxIterations };
}

function searchConverged(simplex: { x: number[]; value: number }[]) {
  const best = simplex[0], worst = simplex[simplex.length - 1];
  const span = Math.max(...simplex.slice(1).flatMap(v => v.x.map((x, j) =>
    Math.abs(x - best.x[j]) / (1 + Math.abs(best.x[j])))));
  return Number.isFinite(best.value) && span < 1e-6 && worst.value - best.value < 1e-7;
}

function validateSearch(start: number[], bounds: [number, number][], maxIterations: number, yieldEvery: number) {
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery < 1 || !start.length || start.length !== bounds.length || !Number.isSafeInteger(maxIterations) || maxIterations < 1 ||
    bounds.some(([lo, hi], i) => !Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi || !Number.isFinite(start[i])))
    throw new Error('invalid bounded search');
}

/** Research callers drain the identical optimizer without scheduling delays. */
export function boundedSearch(objective: (x: number[]) => number, start: number[],
  bounds: [number, number][], maxIterations = 300): SearchResult {
  const search = iterateBoundedSearch(objective, start, bounds, maxIterations);
  let next = search.next();
  while (!next.done) next = search.next();
  return next.value;
}
