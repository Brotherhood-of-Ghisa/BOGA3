import { reduceFibreRun, type FibrePoint } from '@/components/stats/projected-fibre-contour';

const bounds = (points: readonly FibrePoint[]) => [
  Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0])),
  Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1])),
];

const squaredError = (p: FibrePoint, a: FibrePoint, b: FibrePoint) => {
  const v = [b[0] - a[0], b[1] - a[1]];
  const size = v[0] ** 2 + v[1] ** 2;
  const t = size ? Math.min(1, Math.max(0, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / size)) : 0;
  return (p[0] - a[0] - t * v[0]) ** 2 + (p[1] - a[1] - t * v[1]) ** 2;
};

function proveRun(points: readonly FibrePoint[]) {
  const reduced = reduceFibreRun(points);
  expect(reduced[0]).toBe(points[0]);
  expect(reduced[reduced.length - 1]).toBe(points[points.length - 1]);
  expect(bounds(reduced)).toEqual(bounds(points));
  let start = 0;
  for (let r = 1; r < reduced.length; r += 1) {
    const end = points.indexOf(reduced[r], start + 1);
    expect(end).toBeGreaterThan(start);
    for (let i = start; i <= end; i += 1) {
      expect(squaredError(points[i], reduced[r - 1], reduced[r])).toBeLessThanOrEqual(.25 + 1e-9);
    }
    start = end;
  }
}

const cases: readonly (readonly FibrePoint[])[] = [
  [], [[1, 2]], [[0, 0], [0, 0]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[-3, -3], [-2, -2], [-1, -1], [0, 0]],
  [[0, 0], [1, 0], [2, 1]], // distance sqrt(.2), within 0.5 tenths
  [[0, 0], [1, 0], [2, 2]], // distance sqrt(.5), outside tolerance; middle is not an extent
  [[0, 0], [3, 0], [2, 0], [4, 0]], // beyond the replacement endpoint
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[2, 2], [2, 2], [2, 2]],
];
it.each(cases.map(points => ({ points })))('preserves caps/extrema and the clamped-segment bound for $points', ({ points }) => {
  proveRun(points);
});

it('removes only the permitted near-collinear point and retains a turn outside the bound', () => {
  expect(reduceFibreRun([[0, 0], [1, 0], [2, 1]])).toEqual([[0, 0], [2, 1]]);
  expect(reduceFibreRun([[0, 0], [1, 0], [2, 2]])).toHaveLength(3);
});

it('keeps the bound across deterministic irregular, reversing and closed runs', () => {
  let seed = 17;
  for (let run = 0; run < 100; run += 1) {
    const points: FibrePoint[] = [[0, 0]];
    for (let i = 1; i < 40; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      points.push([points[i - 1][0] + seed % 5 - 2, (seed >>> 8) % 13 - 6]);
    }
    if (run % 2) points.push([...points[0]]);
    proveRun(points);
  }
});
