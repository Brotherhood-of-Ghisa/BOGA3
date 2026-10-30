/** Integer tenths of a viewport point, matching the SVG coordinate quantization. */
export type FibrePoint = readonly [number, number];

const distanceSquared = (point: FibrePoint, a: FibrePoint, b: FibrePoint): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
};

const extentAnchors = (points: readonly FibrePoint[]): number[] => {
  const extrema = [0, 0, 0, 0];
  points.forEach((point, i) => {
    if (point[0] < points[extrema[0]][0]) extrema[0] = i;
    if (point[0] > points[extrema[1]][0]) extrema[1] = i;
    if (point[1] < points[extrema[2]][1]) extrema[2] = i;
    if (point[1] > points[extrema[3]][1]) extrema[3] = i;
  });
  return [...new Set([0, ...extrema, points.length - 1])].sort((a, b) => a - b);
};

/** Preserve each visible run's caps/extents; replacement edges stay within 0.05pt. */
export function reduceFibreRun(points: readonly FibrePoint[]): readonly FibrePoint[] {
  if (points.length < 3) return points;
  const anchors = extentAnchors(points);
  const retained = new Set(anchors);
  const pending = anchors.slice(1).map((end, i) => [anchors[i], end]);
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let farthest = -1;
    let maximum = 0.25; // (0.05pt × 10)^2, measured to the clamped segment.
    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceSquared(points[i], points[start], points[end]);
      if (distance > maximum) { maximum = distance; farthest = i; }
    }
    if (farthest < 0) continue;
    retained.add(farthest);
    pending.push([start, farthest], [farthest, end]);
  }
  return [...retained].sort((a, b) => a - b).map(index => points[index]);
}
